// merchantOps.ts — the LP operations, lifted out of routes/merchant.ts so the HTTP routes and the
// Telegram bot run ONE rulebook. Every gate that used to live in a handler lives here; the routes
// keep only body-shape checks and the error→HTTP mapping, and the bot maps the same errors to
// chat copy. A gate that existed only in a route would be a gate the bot silently lacks — the
// kyb_status check on reportPaid is exactly that shape (it is NOT inside claimOrderPayout's CAS).
//
// Import direction: merchantOps → orderMachine (constants) is one-way. Chat-message side effects
// (offer edits, redaction) do NOT live here — they live in services/telegram/messages.ts, which
// orderMachine and this module may both call without forming a cycle.
import {
  claimOrderPayout,
  listMerchantOrders,
  listOpenOffers,
  lockOrder,
  setMerchantFloat,
  setMerchantOnlineSelf,
  setMerchantSpread,
  unlockOrder,
  LIVE_ORDER_STATE_LIST,
  type MerchantOrderRow,
  type MerchantRow,
} from '../db/queries';
import { nonNegativeAmount } from '../lib/amount';

import { bondCap, leverageFor, MIN_BOND, spreadCapFor } from './merchantStats';
import { metrics } from './metrics';
import { DISPUTE_WINDOW_MS, LOCK_TTL_MS } from './orderMachine';
import { PAYEE_COOLDOWN_DAYS } from './routing';

/**
 * The floor of the band an LP may price inside, in basis points off the mid. Not zero: a
 * zero-spread LP wins every `cost` comparison in routing, takes the flow, and then has no margin to
 * absorb the FX drift they're carrying (docs/06 — the FX window is ~24h, the quote's is 45s).
 * The ceiling is the LP's TIER cap (`spreadCapFor`, merchantStats.ts) — the platform sets the price
 * envelope per tier, which also stops a lone LP on a thin corridor from quoting a punitive rate to
 * a payer who cannot see the spread.
 */
export const MIN_SPREAD_BPS = 10;

/** A bank payment reference: NPCI UTRs are 12 digits, RRNs 12, and other rails vary — so this is
 *  deliberately loose on length and strict on character set. Anything a human would want to *say*
 *  is excluded, which is the point. */
export const UTR_RE = /^[A-Za-z0-9][A-Za-z0-9-]{5,63}$/;

/** Order states that still tie up an LP's capacity — the same set committedFloatByMerchant counts,
 *  so the pool never offers an order the lock would immediately refuse for want of headroom. */
const LIVE_FOR_CAPACITY = new Set<string>(LIVE_ORDER_STATE_LIST);

type Fail<E extends string> = { ok: false; error: E; extra?: Record<string, number> };

/**
 * The merchant's work queue: their own orders, plus the open pool they could take. The pool half
 * carries the ELIGIBILITY gate — an LP who isn't currently routable (offline, unapproved, no
 * headroom) is shown their own orders and nothing else. This gate must never drift out of here:
 * a caller that fetched the pool itself would hand a rejected LP the shape of the order book.
 * The payee is present on exactly the orders this LP holds the lock for — enforced by the
 * queries (listOpenOffers redacts in SQL), not by any caller.
 */
export async function listWork(merchant: MerchantRow): Promise<MerchantOrderRow[]> {
  const mine = await listMerchantOrders(merchant.id);
  let open: MerchantOrderRow[] = [];
  if (merchant.status === 'online' && merchant.kyb_status === 'approved') {
    // Capacity is the same figure routing uses, minus what this LP already has in flight — so the
    // pool never shows an order the lock would then refuse.
    const committed = mine
      .filter((o) => LIVE_FOR_CAPACITY.has(o.state))
      .reduce((sum, o) => sum + Number(o.amount_usdc), 0);
    const headroom =
      Math.min(Number(merchant.float_usdc), bondCap(merchant)) - committed;
    if (headroom > 0) {
      open = await listOpenOffers({
        merchantId: merchant.id,
        payoutRail: merchant.payout_rail,
        country: merchant.country,
        spreadBps: merchant.spread_bps,
        maxAmountUsdc: headroom,
        payeeCooldownDays: PAYEE_COOLDOWN_DAYS,
      });
    }
  }
  return [...mine, ...open];
}

export type TakeOrderResult =
  | { ok: true; payoutDestination?: string; payoutName?: string; expiresInSecs: number }
  | Fail<'kyb_not_approved' | 'lock_temporarily_blocked' | 'order_already_taken'>;

/**
 * Take an order — the mutual exclusion the whole marketplace turns on, and the moment the payee
 * is revealed. Exactly one of N concurrent callers wins; the rest get order_already_taken.
 * The reveal rides the same atomic statement as the claim (queries.lockOrder) rather than being a
 * second read afterwards: a lock that succeeded but whose reveal then failed would leave an LP
 * holding an order they cannot see how to pay.
 */
export async function takeOrder(merchant: MerchantRow, orderId: string): Promise<TakeOrderResult> {
  if (merchant.kyb_status !== 'approved') return { ok: false, error: 'kyb_not_approved' };
  if (merchant.lock_bans_until && merchant.lock_bans_until > new Date()) {
    return { ok: false, error: 'lock_temporarily_blocked' };
  }
  // Eligibility is re-derived INSIDE lockOrder's CAS from these; the pool query is only a view.
  const taken = await lockOrder({
    orderId,
    merchantId: merchant.id,
    ttlMs: LOCK_TTL_MS,
    country: merchant.country,
    leverage: leverageFor(merchant.tier),
    payeeCooldownDays: PAYEE_COOLDOWN_DAYS,
    minBondUsdc: MIN_BOND,
  });
  // "already taken", not "not found": the order exists — someone else got there first, or it moved
  // on. Callers that can re-ask (the bot's double-tap) may distinguish "taken by ME" with a read.
  if (!taken) return { ok: false, error: 'order_already_taken' };
  // M6: did the routed LP act inside their head start, or did the pool pick it up after widening?
  // The ratio is how we'll know whether 5s of first refusal is being used or wasted.
  metrics.inc(taken.afterWiden ? 'lock_after_widen' : 'lock_first_choice');
  return {
    ok: true,
    payoutDestination: taken.payoutDestination ?? undefined,
    payoutName: taken.payoutName ?? undefined,
    expiresInSecs: Math.round(LOCK_TTL_MS / 1000),
  };
}

/** Give it back. Free and unpenalised on purpose: if handing an order back costs the same as
 *  going silent, everyone goes silent and the pool waits out every TTL. */
export async function giveBackOrder(
  merchant: MerchantRow,
  orderId: string,
): Promise<{ ok: true } | Fail<'order_not_unlockable'>> {
  if (!(await unlockOrder(orderId, merchant.id))) return { ok: false, error: 'order_not_unlockable' };
  return { ok: true };
}

export type ReportPaidResult =
  | { ok: true; releasesInSecs: number }
  | Fail<'kyb_not_approved' | 'missing_reference' | 'invalid_reference' | 'order_not_claimable'>;

/**
 * "I've paid" — the merchant reports settling the fiat leg out-of-band. Deliberately does NOT move
 * the order to a new state: it stays `payment_detected` (the money is still escrowed and the LP
 * still owes it) and gains `payout_utr` + `payout_claimed_at`. The guarded UPDATE inside
 * `claimOrderPayout` IS the compare-and-set, so a double-tap is idempotent and an order that was
 * rerouted/refunded out from under them can't be claimed. The kyb gate lives HERE and only here —
 * it is not part of the CAS, and dropping it would let a rejected LP claim an order they still hold.
 */
export async function reportPaid(
  merchant: MerchantRow,
  orderId: string,
  referenceRaw: string | undefined,
): Promise<ReportPaidResult> {
  if (merchant.kyb_status !== 'approved') return { ok: false, error: 'kyb_not_approved' };
  const reference = referenceRaw?.trim();
  if (!reference) return { ok: false, error: 'missing_reference' };
  // Shape-checked, not just length-capped. This string is shown to the PAYER as the bank reference
  // for their payment, so unconstrained free text is a channel from the LP straight onto the
  // payer's receipt — a phone number, a name, "call me" — which breaks the rule that the payer
  // never perceives an LP at all. A real UTR/RRN is alphanumeric.
  if (!UTR_RE.test(reference)) return { ok: false, error: 'invalid_reference' };
  const claimed = await claimOrderPayout({
    orderId,
    merchantId: merchant.id,
    reference,
    windowMs: DISPUTE_WINDOW_MS,
  });
  // Not claimable: already claimed, released, refunded, or reassigned to another LP by failover.
  if (!claimed) return { ok: false, error: 'order_not_claimable' };
  return { ok: true, releasesInSecs: Math.round(DISPUTE_WINDOW_MS / 1000) };
}

/**
 * Go online / offline — the LP's own switch. The guard lives in the UPDATE
 * (`setMerchantOnlineSelf`): 'suspended' is neither reachable nor escapable here, and coming
 * online re-checks KYB + the bond floor, so this can't be a side door around the routing gate.
 * On refusal, say which wall they hit — "refused" with no reason is a support ticket.
 */
export async function setOnline(
  merchant: MerchantRow,
  online: boolean,
): Promise<{ ok: true; status: 'online' | 'offline' } | Fail<'merchant_suspended' | 'kyb_not_approved' | 'bond_below_minimum'>> {
  const status = online ? 'online' : 'offline';
  if (!(await setMerchantOnlineSelf(merchant.id, status, MIN_BOND))) {
    if (merchant.status === 'suspended') return { ok: false, error: 'merchant_suspended' };
    if (merchant.kyb_status !== 'approved') return { ok: false, error: 'kyb_not_approved' };
    return { ok: false, error: 'bond_below_minimum' };
  }
  return { ok: true, status };
}

/** Set how much the LP can carry in flight — their own honest capacity, not their stake. Routing
 *  takes min(this, bond × leverage), so declaring more than the stake backs buys nothing. Zero is
 *  legitimate: an LP throttling themselves without going offline. */
export async function setFloat(
  merchant: MerchantRow,
  floatUsdRaw: unknown,
): Promise<{ ok: true; floatUsdc: number } | Fail<'invalid_amount'>> {
  const floatUsd = nonNegativeAmount(floatUsdRaw);
  if (floatUsd === null) return { ok: false, error: 'invalid_amount' };
  await setMerchantFloat(merchant.id, floatUsd);
  return { ok: true, floatUsdc: floatUsd };
}

/** Set the LP's own spread, in basis points off the mid rate — their price inside the platform's
 *  envelope: at least MIN_SPREAD_BPS, at most their tier's cap. The spread IS their entire
 *  revenue; the cap is what the tier buys them. */
export async function setSpread(
  merchant: MerchantRow,
  bpsRaw: unknown,
): Promise<{ ok: true; spreadBps: number } | Fail<'invalid_amount' | 'spread_out_of_band'>> {
  if (!Number.isInteger(bpsRaw)) return { ok: false, error: 'invalid_amount' };
  const bps = bpsRaw as number;
  const cap = spreadCapFor(merchant.tier);
  if (bps < MIN_SPREAD_BPS || bps > cap) {
    return { ok: false, error: 'spread_out_of_band', extra: { minBps: MIN_SPREAD_BPS, maxBps: cap } };
  }
  await setMerchantSpread(merchant.id, bps);
  return { ok: true, spreadBps: bps };
}

/**
 * The seam a real phone-verification layer plugs into. Deliberately unimplemented: a typed number
 * is stored unverified (`contact_phone_verified_at` stays null) and nothing today claims otherwise.
 * The one number that arrives already verified comes from a Telegram contact share, which Telegram
 * itself vouched for — that path writes `verified_via = 'telegram'` and never calls this.
 *
 * The machinery to build on already exists for the pay-by-phone alias: services/phoneOtp.ts.
 */
export function verifyContactPhone(): never {
  throw new Error('not_implemented');
}
