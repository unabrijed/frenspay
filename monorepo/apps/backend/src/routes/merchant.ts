// merchant.ts — the REAL (human) merchant/LP side of the off-ramp.
//
// Until now every LP was a simulation: `simMerchant.ts` played the fiat leg and no one recorded who
// the rupees were actually for. These routes give a person the other half of the trade — see the
// order with the payee's real UPI ID, pay it out-of-band, report it, and get the escrow released
// once a dispute window closes. Their stake (`bond_usdc`) is what makes that trustable: an upheld
// dispute draws it down, and dropping below MIN_BOND auto-suspends them out of routing.
//
// The fiat leg is NOT integrated with any payout rail — the merchant types a UTR by hand. That keeps
// this inside the "simulated rails" posture of docs/11 (no real fiat moves, so no payout licensing).
import type { FastifyInstance } from 'fastify';

import type {
  MerchantOrder,
  MerchantLedgerResponse,
  MerchantOrdersResponse,
  MerchantProfile,
  PayoutMethod,
  PrepareTransferResponse,
  StakePrepareRequest,
  SubmitPayoutRequest,
} from '@fpay/shared';
import { PublicKey } from '@solana/web3.js';

import { requireMerchant, requireUserId } from '../auth';
import { config } from '../envConfig';
import {
  cancelStakeWithdrawal,
  claimOrderPayout,
  createPendingTransfer,
  getMerchantForUser,
  getUserKycTier,
  getWalletForUser,
  appendKybEvent,
  insertMerchantApplication,
  listKybEvents,
  listMerchantDisputes,
  listMerchantOrders,
  merchantEarnings,
  submitMerchantKyb,
  listOpenOffers,
  lockOrder,
  setMerchantAlertChannel,
  unlockOrder,
  listStakeWithdrawals,
  LIVE_ORDER_STATE_LIST,
  requestStakeWithdrawal,
  setMerchantFloat,
  setMerchantOnlineSelf,
  setMerchantSpread,
  type KybEventRow,
  type MerchantOrderRow,
  type MerchantRow,
  type StakeWithdrawalRow,
} from '../db/queries';
import { amt, nonNegativeAmount, positiveAmount, USDC_DECIMALS } from '../lib/amount';
import { acceptsLps, CORRIDORS, PAYOUT_METHODS } from '../lib/corridors';
import { KYB_SUBMITTABLE, validateKybFields } from '../lib/kyb';
import { formatAmount } from '../lib/units';
import { KYC_APPROVED_TIER } from '../services/kyc';
import { DISPUTE_WINDOW_MS, LOCK_TTL_MS } from '../services/orderMachine';
import { leverageFor, MIN_BOND, tierProgress } from '../services/merchantStats';
import { buildUsdcTransfer } from '../services/solana';

/** Cap on a single stake deposit — a typo shouldn't be able to move a merchant's whole balance. */
const MAX_STAKE_DEPOSIT_USD = 50_000;

/**
 * Band an LP may price inside, in basis points off the mid. The floor is not zero: a zero-spread LP
 * wins every `cost` comparison in routing, takes the flow, and then has no margin to absorb the FX
 * drift they're carrying (docs/06 — the FX window is ~24h, the quote's is 45s). The ceiling stops a
 * lone LP on a thin corridor from quoting a punitive rate to a payer who cannot see the spread.
 */
const MIN_SPREAD_BPS = 10;
const MAX_SPREAD_BPS = 300;

/** Order states that still tie up an LP's capacity — the same set committedFloatByMerchant counts,
 *  so the pool never offers an order the lock would immediately refuse for want of headroom. */
const LIVE_FOR_CAPACITY = new Set<string>(LIVE_ORDER_STATE_LIST);

/** Adapters services/alert knows how to reach. Validated here so an LP can't store an address for a
 *  channel that will never fire and then wonder why they hear nothing. */
const ALERT_CHANNELS: readonly string[] = ['telegram'];

/** A bank payment reference: NPCI UTRs are 12 digits, RRNs 12, and other rails vary — so this is
 *  deliberately loose on length and strict on character set. Anything a human would want to *say*
 *  is excluded, which is the point. */
const UTR_RE = /^[A-Za-z0-9][A-Za-z0-9-]{5,63}$/;

export function toMerchantProfile(
  m: MerchantRow,
  pending?: StakeWithdrawalRow,
  kybEvents?: KybEventRow[],
  settled?: number,
): MerchantProfile {
  return {
    id: m.id,
    name: m.name,
    kybStatus: m.kyb_status,
    // The reviewer's outstanding question or reason, shown to the merchant verbatim. "Rejected"
    // with nothing after it is not a decision anyone can act on.
    kybNote: m.kyb_note ?? undefined,
    // Echoed back so a more-info request re-opens the form already filled in, rather than asking
    // someone to retype seven fields to fix one.
    kybFields: m.kyb_fields ?? undefined,
    kybSubmittedAt: m.kyb_submitted_at?.toISOString(),
    kybEvents: kybEvents?.map((e) => ({
      fromStatus: e.from_status,
      toStatus: e.to_status,
      event: e.event,
      note: typeof e.detail?.note === 'string' ? e.detail.note : undefined,
      createdAt: e.created_at.toISOString(),
    })),
    status: m.status,
    payoutRail: m.payout_rail,
    treasuryAddress: m.treasury_address,
    country: m.country,
    bondUsdc: m.bond_usdc,
    minBondUsdc: formatAmount(amt(MIN_BOND), USDC_DECIMALS),
    floatUsdc: m.float_usdc,
    // What routing will actually let them carry. Shown so a capped LP can see the reason is their
    // stake, not a silent haircut — `floatUsdc` alone made the cap look like a bug.
    maxFloatUsdc: formatAmount(amt(Number(m.bond_usdc)).times(leverageFor(m.tier)), USDC_DECIMALS),
    tier: m.tier,
    // Only computable with the settled count, which is one extra read — so callers that don't need
    // the dashboard hero (and don't pass it) simply omit it rather than paying for it.
    tierProgress:
      settled == null
        ? undefined
        : (tierProgress({
            settled,
            successRate: Number(m.success_rate),
            disputeRate: Number(m.dispute_rate),
            avgCompletionSecs: m.avg_completion_secs,
          }) ?? undefined),
    spreadBps: m.spread_bps,
    pendingWithdrawal: pending
      ? { id: pending.id, amountUsdc: pending.amount_usdc, requestedAt: pending.requested_at.toISOString() }
      : undefined,
    successRate: Number(m.success_rate),
    disputeRate: Number(m.dispute_rate),
    positiveRate: Number(m.positive_rate),
  };
}

function toMerchantOrder(r: MerchantOrderRow): MerchantOrder {
  return {
    id: r.id,
    referenceCode: r.reference_code,
    state: r.state,
    resolution: r.resolution,
    currency: r.currency,
    amountInr: r.amount_inr,
    amountUsdc: r.amount_usdc,
    // Already NULL on anything this LP doesn't hold — listOpenOffers redacts in SQL, so this mapper
    // cannot leak a payee by forgetting to.
    payoutDestination: r.payout_destination ?? undefined,
    payoutName: r.payout_name ?? undefined,
    payoutMethod: r.payout_method,
    payoutUtr: r.payout_utr ?? undefined,
    payoutClaimedAt: r.payout_claimed_at?.toISOString(),
    expiresAt: r.expires_at?.toISOString(),
    createdAt: r.created_at.toISOString(),
    mine: r.mine,
    lockedAt: r.locked_at?.toISOString(),
    lockExpiresAt: r.lock_expires_at?.toISOString(),
    offerWidensAt: r.offer_widens_at?.toISOString(),
  };
}

export async function registerMerchantRoutes(app: FastifyInstance) {
  /**
   * Onboarding: apply to become an LP (pending KYB, offline until approved).
   *
   * This was previously UNAUTHENTICATED, which was a live hole — anonymous callers could insert
   * unbounded merchant rows, and every row is walked by `recomputeMerchantStats` on the same
   * confirmer tick that drives the order worker. Worse, `isMerchantTreasuryAddress` is used to
   * REJECT send recipients, so registering someone else's address as a treasury would permanently
   * block fpay sends to it.
   */
  app.post<{ Body: { name?: string; payoutMethod?: PayoutMethod; treasuryAddress?: string } }>(
    '/merchants/apply',
    async (req, reply) => {
      const userId = requireUserId(req);
      // Merchant KYC: the human behind the merchant must be identity-verified (the same personal
      // tier-2 KYC that gates cash-out). KYB approval is a separate, later step on top of this.
      if ((await getUserKycTier(userId)) < KYC_APPROVED_TIER) {
        return reply.code(403).send({ error: 'kyc_required' });
      }
      const { name, payoutMethod, treasuryAddress } = req.body ?? {};
      const rail = payoutMethod ?? 'UPI';
      if (!name || !treasuryAddress) return reply.code(400).send({ error: 'missing_fields' });
      if (!PAYOUT_METHODS.includes(rail)) return reply.code(400).send({ error: 'invalid_rail' });
      // A corridor that never falls back to the pool has no LP network to join. Note this is now a
      // narrower rejection than "the corridor prefers a provider": QRIS prefers Xendit AND keeps an
      // LP fallback, so Indonesian LPs may now register — that fallback pool cannot exist if the
      // door is shut on them.
      if (!acceptsLps(rail)) {
        return reply.code(400).send({ error: 'rail_not_open_to_lps' });
      }
      // The corridor is the country authority, mirroring rails.ts (invariant 1). Not taken from the
      // request and not from users.country: an LP declaring their own country would be declaring
      // which orders they can be offered, and users.country is a display preference that the money
      // paths deliberately never read (docs/18).
      const country = CORRIDORS[rail]?.country;
      if (!country) return reply.code(400).send({ error: 'invalid_rail' });
      try {
        new PublicKey(treasuryAddress); // release target — must be a valid Solana address
      } catch {
        return reply.code(400).send({ error: 'invalid_treasury_address' });
      }
      if (await getMerchantForUser(userId)) return reply.code(409).send({ error: 'already_a_merchant' });
      const id = await insertMerchantApplication({ userId, name, payoutRail: rail, treasuryAddress, country });
      return reply.code(201).send({ id, kybStatus: 'pending' });
    },
  );

  /**
   * The merchant's work queue: their own orders, plus the open pool they could take.
   *
   * Two sets in one response because they are one screen and one poll. `mine` distinguishes them,
   * and the payee is present on exactly the orders this LP holds the lock for — enforced by the
   * queries, not by this handler.
   */
  app.get('/merchants/orders', async (req): Promise<MerchantOrdersResponse> => {
    const merchant = await requireMerchant(req);
    const mine = await listMerchantOrders(merchant.id);

    // An LP who isn't currently routable shouldn't be shown work they can't take — and shouldn't be
    // handed the shape of the order book either.
    let open: MerchantOrderRow[] = [];
    if (merchant.status === 'online' && merchant.kyb_status === 'approved') {
      // Capacity is the same figure routing uses, minus what this LP already has in flight — so the
      // pool never shows an order the lock would then refuse.
      const committed = mine
        .filter((o) => LIVE_FOR_CAPACITY.has(o.state))
        .reduce((sum, o) => sum + Number(o.amount_usdc), 0);
      const headroom =
        Math.min(Number(merchant.float_usdc), Number(merchant.bond_usdc) * leverageFor(merchant.tier)) - committed;
      if (headroom > 0) {
        open = await listOpenOffers({
          merchantId: merchant.id,
          payoutRail: merchant.payout_rail,
          country: merchant.country,
          spreadBps: merchant.spread_bps,
          maxAmountUsdc: headroom,
        });
      }
    }
    return { orders: [...mine, ...open].map(toMerchantOrder) };
  });

  /**
   * Take an order — the mutual exclusion the whole marketplace turns on, and the moment the payee
   * is revealed. Exactly one of N concurrent callers gets a 200; the rest get 409.
   *
   * The reveal rides the same atomic statement as the claim (queries.lockOrder) rather than being a
   * second read afterwards: a lock that succeeded but whose reveal then failed would leave an LP
   * holding an order they cannot see how to pay.
   */
  app.post<{ Params: { id: string } }>('/merchants/orders/:id/lock', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (merchant.kyb_status !== 'approved') return reply.code(403).send({ error: 'kyb_not_approved' });
    if (merchant.lock_bans_until && merchant.lock_bans_until > new Date()) {
      return reply.code(429).send({ error: 'lock_temporarily_blocked' });
    }
    // Eligibility is re-derived INSIDE lockOrder's CAS from these; the pool query is only a view.
    const taken = await lockOrder({
      orderId: req.params.id,
      merchantId: merchant.id,
      ttlMs: LOCK_TTL_MS,
      country: merchant.country,
      leverage: leverageFor(merchant.tier),
    });
    // 409, not 404: the order exists — someone else got there first, or it moved on.
    if (!taken) return reply.code(409).send({ error: 'order_already_taken' });
    return {
      ok: true,
      payoutDestination: taken.payoutDestination ?? undefined,
      payoutName: taken.payoutName ?? undefined,
      expiresInSecs: Math.round(LOCK_TTL_MS / 1000),
    };
  });

  /** Give it back. Free and unpenalised on purpose: if handing an order back costs the same as
   *  going silent, everyone goes silent and the pool waits out every TTL. */
  app.post<{ Params: { id: string } }>('/merchants/orders/:id/unlock', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (!(await unlockOrder(req.params.id, merchant.id))) {
      return reply.code(409).send({ error: 'order_not_unlockable' });
    }
    return { ok: true };
  });

  /**
   * Submit (or resubmit) the business details behind this LP.
   *
   * The person is already verified — /merchants/apply requires the same tier-2 vendor KYC that gates
   * cash-out. This is the BUSINESS: who they trade as, and above all which account the fiat will
   * actually leave from. That last field is the one that matters: the documented failure mode for
   * this entire business shape is third-party money moving through a personal account and the
   * account being frozen (docs/06, docs/08), and knowing which account BEFORE they start is what
   * makes that reviewable instead of discoverable afterwards.
   *
   * Accepted from 'pending' and 'more_info' — the resubmission path is the same call, which is what
   * turns a rejection into a conversation.
   */
  app.post<{ Body: { fields?: Record<string, unknown> } }>('/merchants/kyb', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (!KYB_SUBMITTABLE.includes(merchant.kyb_status)) {
      return reply.code(409).send({ error: 'kyb_not_submittable', kybStatus: merchant.kyb_status });
    }
    // Trust boundary. The client checks the same rules first, purely so a typo doesn't cost a round
    // trip; nothing it says is believed here.
    const checked = validateKybFields(merchant.country, req.body?.fields);
    if (!checked.ok) return reply.code(400).send({ error: 'invalid_kyb_fields', invalid: checked.invalid });

    const from = await submitMerchantKyb(merchant.id, checked.fields, KYB_SUBMITTABLE);
    // Lost a race with a reviewer who moved it mid-request.
    if (from == null) return reply.code(409).send({ error: 'kyb_not_submittable' });
    // The field VALUES deliberately don't go in the event log: they live in merchants.kyb_fields,
    // and copying business identifiers into an append-only table means they can never be corrected
    // or erased. The log records that a submission happened, not what was in it.
    await appendKybEvent(merchant.id, from, 'submitted', 'kyb_submitted', { country: merchant.country });
    return { ok: true, kybStatus: 'submitted' };
  });

  /**
   * The LP's own numbers: what settled to them, and every dispute raised against them.
   *
   * One route for both because they are one screen and one question — "how is this going" — and
   * because a dispute is exactly the thing that makes the earnings figure not the whole story.
   */
  app.get<{ Querystring: { days?: string } }>('/merchants/ledger', async (req): Promise<MerchantLedgerResponse> => {
    const merchant = await requireMerchant(req);
    // Clamped, not trusted: this interpolates into an interval, and an unbounded window is a table
    // scan an LP could ask for on a 15-second poll.
    const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 365);
    const [e, disputes] = await Promise.all([merchantEarnings(merchant.id, days), listMerchantDisputes(merchant.id)]);
    return {
      earnings: {
        windowDays: days,
        settled: e.settled,
        usdcIn: e.usdc_in,
        fiatOut: e.fiat_out,
        // No completed orders yet → no currency to report. Fall back to the corridor's, so the
        // empty state still reads "₹0" rather than "0".
        currency: e.currency ?? CORRIDORS[merchant.payout_rail]?.currency ?? 'INR',
      },
      disputes: disputes.map((d) => ({
        id: d.id,
        orderId: d.order_id,
        referenceCode: d.reference_code,
        reason: d.reason ?? undefined,
        status: d.status as 'open' | 'resolved',
        resolution: (d.resolution as 'upheld' | 'rejected' | null) ?? undefined,
        amountUsdc: d.amount_usdc,
        createdAt: d.created_at.toISOString(),
        resolvedAt: d.resolved_at?.toISOString(),
      })),
    };
  });

  /**
   * Where to reach this LP. The token flow lives on the client: they open the bot, it sends
   * `/start <token>`, and the bot's own webhook calls this with the chat id it learned. Storing the
   * address is all the backend needs to know.
   */
  app.post<{ Body: { channel?: string; address?: string } }>('/merchants/alerts', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const { channel, address } = req.body ?? {};
    if (!channel || !address) return reply.code(400).send({ error: 'missing_fields' });
    if (!ALERT_CHANNELS.includes(channel)) return reply.code(400).send({ error: 'unsupported_channel' });
    await setMerchantAlertChannel(merchant.id, channel, address);
    return { ok: true };
  });

  /**
   * "I've paid" — the merchant reports settling the fiat leg out-of-band.
   *
   * Deliberately does NOT move the order to a new state: it stays `payment_detected` (the money is
   * still escrowed and the LP still owes it) and gains `payout_utr` + `payout_claimed_at`. The
   * guarded UPDATE inside `claimOrderPayout` IS the compare-and-set, so a double-tap is idempotent
   * and an order that was rerouted/refunded out from under them can't be claimed.
   */
  app.post<{ Params: { id: string }; Body: SubmitPayoutRequest }>(
    '/merchants/orders/:id/paid',
    async (req, reply) => {
      const merchant = await requireMerchant(req);
      if (merchant.kyb_status !== 'approved') return reply.code(403).send({ error: 'kyb_not_approved' });
      const reference = req.body?.reference?.trim();
      if (!reference) return reply.code(400).send({ error: 'missing_reference' });
      // Shape-checked, not just length-capped. This string is now shown to the PAYER as the bank
      // reference for their payment, so unconstrained free text is a channel from the LP straight
      // onto the payer's receipt — a phone number, a name, "call me" — which breaks the rule that
      // the payer never perceives an LP at all. A real UTR/RRN is alphanumeric.
      if (!UTR_RE.test(reference)) return reply.code(400).send({ error: 'invalid_reference' });
      const claimed = await claimOrderPayout({
        orderId: req.params.id,
        merchantId: merchant.id,
        reference,
        windowMs: DISPUTE_WINDOW_MS,
      });
      // 409 rather than 404: the order exists, it just isn't claimable (already claimed, released,
      // refunded, or reassigned to another LP by the failover path).
      if (!claimed) return reply.code(409).send({ error: 'order_not_claimable' });
      return { ok: true, releasesInSecs: Math.round(DISPUTE_WINDOW_MS / 1000) };
    },
  );

  /** Set how much the LP can carry in flight — their own honest capacity, not their stake.
   *  Routing takes min(this, bond × leverage), so declaring more than the stake backs buys nothing. */
  app.post<{ Body: { floatUsd?: number } }>('/merchants/float', async (req, reply) => {
    const merchant = await requireMerchant(req);
    // Zero is a legitimate float — an LP throttling themselves without going offline.
    const floatUsd = nonNegativeAmount(req.body?.floatUsd);
    if (floatUsd === null) return reply.code(400).send({ error: 'invalid_amount' });
    await setMerchantFloat(merchant.id, floatUsd);
    return { ok: true, floatUsdc: floatUsd };
  });

  /**
   * Go online / offline. The LP's own switch — until now `merchants.status` was writable only by an
   * admin, and the documented workaround was setting float to 0, which is a different statement
   * ("I have no capacity" vs "I'm not here") that routing and the LP's own dashboard both misread.
   *
   * The guard lives in the UPDATE (`setMerchantOnlineSelf`): 'suspended' is neither reachable nor
   * escapable here, and coming online re-checks KYB + the bond floor, so this can't be used as a
   * side door around the routing gate.
   */
  app.post<{ Body: { online?: boolean } }>('/merchants/status', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (typeof req.body?.online !== 'boolean') return reply.code(400).send({ error: 'missing_fields' });
    const status = req.body.online ? 'online' : 'offline';
    if (!(await setMerchantOnlineSelf(merchant.id, status, MIN_BOND))) {
      // Say which wall they hit — "refused" with no reason is the kind of thing an LP files a
      // support ticket about.
      if (merchant.status === 'suspended') return reply.code(409).send({ error: 'merchant_suspended' });
      if (merchant.kyb_status !== 'approved') return reply.code(409).send({ error: 'kyb_not_approved' });
      return reply.code(409).send({ error: 'bond_below_minimum' });
    }
    return { ok: true, status };
  });

  /**
   * Set the LP's own spread, in basis points off the mid rate.
   *
   * This had no writer at all outside the seed: every real LP was pinned to the column default of
   * 50 bps forever, unable to compete on the one axis that is genuinely theirs — while `cost`
   * carries 0.20 of the routing score and the spread IS their entire revenue.
   */
  app.post<{ Body: { spreadBps?: number } }>('/merchants/spread', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const bps = req.body?.spreadBps;
    if (!Number.isInteger(bps)) return reply.code(400).send({ error: 'invalid_amount' });
    if (bps! < MIN_SPREAD_BPS || bps! > MAX_SPREAD_BPS) {
      return reply.code(400).send({ error: 'spread_out_of_band', minBps: MIN_SPREAD_BPS, maxBps: MAX_SPREAD_BPS });
    }
    await setMerchantSpread(merchant.id, bps!);
    return { ok: true, spreadBps: bps };
  });

  /**
   * Stake: build a USDC transfer from the merchant's own wallet to the stake treasury. Reuses the
   * ordinary prepare/sign/submit seam — the client signs this and then calls the EXISTING
   * `/transfer/submit` (which is scoped to `from_user_id`, so it accepts any transfer the caller
   * owns). The bond is credited only when the transfer CONFIRMS, in `onTransferConfirmedAndNotify`.
   *
   * `kind` stays 'send' on purpose: this is real USDC leaving the merchant's wallet, which is exactly
   * what the rolling daily send cap measures. A bespoke kind would silently escape that cap.
   */
  app.post<{ Body: StakePrepareRequest }>('/merchants/stake/prepare', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (!config.stakeTreasuryAddress) return reply.code(503).send({ error: 'staking_unavailable' });
    const amountUsd = positiveAmount(req.body?.amountUsd);
    if (amountUsd === null) return reply.code(400).send({ error: 'invalid_amount' });
    if (amountUsd > MAX_STAKE_DEPOSIT_USD) return reply.code(400).send({ error: 'amount_too_large' });

    const wallet = await getWalletForUser(merchant.user_id!);
    if (!wallet) return reply.code(404).send({ error: 'wallet_not_found' });

    let built: { unsignedTx: string; feePayer: string };
    try {
      built = await buildUsdcTransfer({
        fromOwner: wallet.address,
        toOwner: config.stakeTreasuryAddress,
        amountUsd,
      });
    } catch (e) {
      req.log.error({ err: e }, 'stake transfer build failed');
      return reply.code(503).send({ error: 'solana_unavailable' });
    }
    const { id: transferId } = await createPendingTransfer({
      fromUserId: merchant.user_id!,
      toUserId: null,
      fromAddress: wallet.address,
      toAddress: config.stakeTreasuryAddress,
      amountUsd,
      kind: 'send',
      note: 'merchant stake',
    });
    return { unsignedTx: built.unsignedTx, feePayer: built.feePayer, transferId } satisfies PrepareTransferResponse;
  });

  /**
   * Ask for stake back — the way OUT, which did not exist. `bond_usdc` could only ever be credited
   * on a confirmed deposit or fined down by a dispute, which makes staking a one-way door.
   *
   * This is a REQUEST, not a transfer, and deliberately so: `STAKE_TREASURY_ADDRESS` is a public key
   * with no signer (envConfig.ts:106-110 — "add a secret key here only when merchants can offboard
   * and withdraw"). Automating the release means putting a second hot key in env, which is its own
   * security decision and not one to make as a side effect of this. A human releases it from the
   * admin console.
   *
   * The bond is debited HERE, not at release. Money an LP has asked to withdraw must stop backing
   * new orders immediately; every precondition (no open request, nothing in flight, no open dispute,
   * enough bond) is a predicate inside the one statement, so two concurrent requests cannot both win.
   */
  app.post<{ Body: { amountUsd?: string | number } }>('/merchants/stake/withdraw', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const amountUsd = positiveAmount(req.body?.amountUsd);
    if (amountUsd === null) return reply.code(400).send({ error: 'invalid_amount' });

    const id = await requestStakeWithdrawal(merchant.id, amountUsd);
    if (!id) {
      // One refusal for four causes would be useless to the person reading it, so re-read and say
      // which. Racy by nature — this is an error message, not a gate; the gate is the statement above.
      const open = (await listStakeWithdrawals(merchant.id)).find((w) => w.status === 'requested');
      if (open) return reply.code(409).send({ error: 'withdrawal_already_pending' });
      if (Number(merchant.bond_usdc) < amountUsd) return reply.code(409).send({ error: 'insufficient_bond' });
      return reply.code(409).send({ error: 'orders_in_flight' });
    }
    return reply.code(201).send({ id, amountUsdc: formatAmount(amt(amountUsd), USDC_DECIMALS) });
  });

  /** Changed their mind before a human released it — the bond goes straight back. */
  app.post<{ Params: { id: string } }>('/merchants/stake/withdraw/:id/cancel', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (!(await cancelStakeWithdrawal(merchant.id, req.params.id))) {
      return reply.code(409).send({ error: 'withdrawal_not_cancellable' });
    }
    return { ok: true };
  });
}
