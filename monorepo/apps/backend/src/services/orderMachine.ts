// orderMachine.ts — the order state machine (stablecoin-onofframp-architecture.pdf, page 2).
// Happy path: quote_locked → pay_instructions → waiting_payment → payment_detected →
// merchant_confirms → funds_released → completed. Failure branches overlay a transient resolution
// (delayed / needs_action / under_review) and terminate at refunded. All escrow movement is real
// in a backend-custodied escrow pool (docs/16 — the on-chain program is shelved); the simulated merchant/LP and
// escalation timers live in simMerchant.ts.
import { randomBytes } from 'node:crypto';

import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey, type ParsedInstruction } from '@solana/web3.js';

import type { Order, OrderResolution, OrderState, PayoutMethod } from '@fpay/shared';

import { config } from '../envConfig';
import { CORRIDORS } from '../lib/corridors';
import { amt, USDC_DECIMALS } from '../lib/amount';
import { BN, formatAmount } from '../lib/units';
import {
  appendOrderEvent,
  attachSignatureByReference,
  casOrderState,
  countRecentLockAbandons,
  createPendingTransfer,
  creditStakeOnConfirm,
  drawDownBond,
  expireOrderLocks,
  getOrderAlertInfo,
  setLockBan,
  getDisputeRow,
  getGroupSettlement,
  getEscrowReleaseTransfer,
  getOrderByEscrowReleaseTransfer,
  getOrderForUser,
  getOrderPlatformFee,
  getOrderSimRow,
  getQuoteRowForUser,
  getSendNotifyInfo,
  getTransferBySignature,
  getWalletForUser,
  insertOrder,
  insertRiskEvent,
  insertRoutingAttempt,
  listOrdersByEscrowFundTransfer,
  listUnattributedDeposits,
  listRoutingAttempts,
  markGroupFundSubmitted,
  markLatestAttemptOutcome,
  reassignOrderMerchant,
  recordEscrowTransfer,
  resolveDispute,
  setTransferStatus,
  unfreezeOrderAfterDispute,
  updateOrder,
} from '../db/queries';

import { alertLockLost, alertOrderIncoming, alertOrderReady } from './alert';
import { onBridgeCompanionConfirmed } from './bridge/machine';
import { checkCashOutLimit, scoreAndRecord, type LimitCheck } from './compliance';
import { metrics } from './metrics';
import { notifyPaymentSent, notifyReceived, notifyRefunded } from './notify';
import { rankMerchants } from './routing';
import { buildUsdcTransfer, confirmSignature, connection, escrowPoolAddress, getTransferStatus, sendFromEscrowPool, usdcMint } from './solana';
import { memoOf } from './transferVerify';

/** Time a stuck order sits in a state before the worker begins escalating it. Demo-tuned. */
export const ORDER_SLA_MS = 30_000;

/**
 * How long a REAL (human) merchant has to notice an order and mark it paid before escalation starts.
 * ORDER_SLA_MS is 30s — fine for a worker that reacts in one tick, absurd for a person who has to
 * open a banking app. A real LP that blows this still escalates delayed → under_review → reroute/
 * refund through the existing ladder, so the payer is protected either way.
 */
export const MERCHANT_CLAIM_MS = 600_000; // 10 min

/** After the merchant reports paying, how long the payer has to dispute before the escrow releases. */
export const DISPUTE_WINDOW_MS = 120_000; // 2 min

/**
 * Claim SLA for a provider-driven (platform 'psp' row) order: a real vendor disbursement sits in
 * ACCEPTED/REQUESTED well past ORDER_SLA_MS's 30s, and the first escalation used to close the
 * polling gate for good — 120s keeps the demo brisk without manufacturing false "delayed" flags.
 */
export const PROVIDER_SLA_MS = 120_000;

/**
 * How long a release/refund waits inline for its tx to land before the worker moves on. Most land in
 * under ten seconds; the rest are finished by the confirmer from the recorded row, so this is a
 * ceiling on how long three settling orders can hold one worker tick — not the deadline to land.
 */
const SETTLE_CONFIRM_MS = 15_000;

/** A settlement tx that has not landed this long after broadcast is written off as dropped: a
 *  blockhash is valid for ~60–90 s, so past this it cannot land any more. Until then the order
 *  keeps its in-flight tx and broadcasts nothing new. */
export const SETTLE_DROPPED_MS = 3 * 60_000;

/** M3: cap on routing attempts per order (initial assignment + up to 2 reroutes) before refunding. */
export const MAX_ROUTING_ATTEMPTS = 3;

/**
 * How long the LP routing picked holds an order exclusively before the rest of the eligible pool
 * can take it. This IS the reward for ranking first — first refusal on every order, which costs the
 * platform nothing and is worth more to a good LP than any badge.
 *
 * Short on purpose. The payer is standing somewhere waiting, and a head start long enough to matter
 * to a sleeping LP is long enough to hurt them. 5s is still a real window (2026-08-24): the
 * preferred LP is pushed a deep link in the same pass this clock starts, while rivals can't even
 * SEE the order until it widens and then only on their next poll — exclusivity plus a push beat
 * a blind 3s poller every time. What 5s no longer forgives is not being reachable.
 */
export const HEAD_START_MS = 5_000;

/**
 * How long a lock is held before it lapses and the order returns to the pool. Generous because the
 * LP is doing something real in another app — opening their bank, typing a VPA, waiting on an OTP —
 * and a lock that expires mid-payment would mean two LPs paying the same payee, which is the one
 * outcome the lock exists to prevent. Well inside MERCHANT_CLAIM_MS, so the payer's SLA still
 * outlives two full failed locks.
 */
export const LOCK_TTL_MS = 300_000; // 5 min

/** Abandon this many locks in LOCK_ABANDON_WINDOW_H and lose the ability to lock for a while. */
const LOCK_ABANDON_LIMIT = 3;
const LOCK_ABANDON_WINDOW_H = 24;
const LOCK_BAN_MINUTES = 60;

type ConfirmResult =
  | { ok: true; order: Order; unsignedTx: string; feePayer: string; sponsored: boolean; transferId: string; referenceCode: string }
  | { error: 'limit_exceeded'; limit: Extract<LimitCheck, { ok: false }> }
  | { error: 'quote_not_found' | 'quote_expired' | 'wallet_not_found' | 'solana_unavailable' | 'unsupported_payout_method' };

/** quote_locked → pay_instructions: create the order + the unsigned escrow-funding tx for the user. */
export async function confirmOrderFromQuote(userId: string, quoteId: string): Promise<ConfirmResult> {
  const quote = await getQuoteRowForUser(quoteId, userId);
  if (!quote) return { error: 'quote_not_found' };
  // Recheck at confirm, before any wallet/escrow work: old or manually inserted quotes are not authority.
  if (!CORRIDORS[quote.payoutMethod]) return { error: 'unsupported_payout_method' };
  if (quote.expiresAt.getTime() < Date.now()) return { error: 'quote_expired' };

  const wallet = await getWalletForUser(userId);
  if (!wallet?.address) return { error: 'wallet_not_found' };

  // M5: enforce cash-out KYC limits against the REAL amountUsdc here (the /orders/quote estimate is
  // only an early gate), using rolling in-flight volume — so a user can't bypass the cap by reusing or
  // stacking quotes. Also write the cash-out risk_event (the off-ramp leg had no audit trail).
  const lim = await checkCashOutLimit(userId, quote.amountUsdc);
  if (!lim.ok) return { error: 'limit_exceeded', limit: lim };
  await scoreAndRecord({ userId, kind: 'cash_out', amountUsd: quote.amountUsdc });

  // The legs. One when a single LP can carry the payment; N when routing had to split it
  // (quote.legs: each an LP and what they are owed). Each leg is an ordinary order with its own
  // reference, lock, claim, release and dispute — the rest of the machine never learns the word
  // "leg". The platform's flat cut rides the PRIMARY leg: one fee per conversion, however many legs,
  // so its order carries lp-owed + fee and its release pays the fee out (getOrderPlatformFee answers
  // '0' for the others).
  const fee = new BN(quote.platformFeeUsdc);
  const legs = quote.legs
    ? quote.legs.map((l, i) => ({
        merchantId: l.merchantId as string | null,
        amountFiat: l.amountFiat as string | null,
        amountUsdc: Number(formatAmount(i === 0 ? new BN(l.amountUsdc).plus(fee) : new BN(l.amountUsdc), USDC_DECIMALS)),
      }))
    : [{ merchantId: quote.merchantId, amountFiat: null, amountUsdc: quote.amountUsdc }];
  const refs = legs.map(() => 'PAY-' + randomBytes(4).toString('hex').toUpperCase());

  // The escrow-funding tx: ONE transfer of the gross amount from the payer to the escrow pool (one
  // token account, docs/16), carrying the primary leg's reference as an SPL Memo — the binding
  // between this deposit and these orders that transferVerify.ts requires before the row may flip.
  // Same prepare/submit shape as /transfer/prepare, so the web client signs it via the existing
  // signer and never learns how many legs it funded.
  let built;
  try {
    built = await buildUsdcTransfer({ fromOwner: wallet.address, toOwner: escrowPoolAddress(), amountUsd: quote.amountUsdc, memo: refs[0] });
  } catch {
    return { error: 'solana_unavailable' };
  }

  // One transfers row — there is one signature — for the whole debit; every leg points at it, and
  // one confirmation advances them all (onTransferConfirmed).
  const { id: transferId } = await createPendingTransfer({
    fromUserId: userId,
    toUserId: null,
    fromAddress: wallet.address,
    toAddress: escrowPoolAddress(),
    amountUsd: quote.amountUsdc,
    kind: 'escrow_fund',
    note: refs.join(' '),
  });

  let primaryId = '';
  for (const [i, leg] of legs.entries()) {
    const orderId = await insertOrder({
      userId,
      quoteId,
      merchantId: leg.merchantId,
      amountUsdc: leg.amountUsdc,
      amountFiat: leg.amountFiat,
      groupId: i === 0 ? null : primaryId,
      referenceCode: refs[i],
      state: 'pay_instructions',
      escrowFundTransferId: transferId,
      note: refs[i],
    });
    if (i === 0) primaryId = orderId;
    await appendOrderEvent(orderId, null, 'quote_locked', 'quote_created');
    await appendOrderEvent(orderId, 'quote_locked', 'pay_instructions', 'confirm_order');
    // M3: record the initial LP assignment as routing attempt #1 (the failover audit trail + tried-set).
    if (leg.merchantId) {
      await insertRoutingAttempt({ orderId, merchantId: leg.merchantId, sequence: 1, outcome: 'assigned', reason: 'initial' });
    }

    // Tell the routed LP NOW, while the payer is still signing and the deposit is confirming — a few
    // seconds of head start for free, with nothing added to what the payer sees or waits for.
    //
    // This is where the payer-experience constraint lands in code: the LP-side race has to happen
    // inside time the payer already spends, never in front of them. No "finding someone to pay you"
    // screen exists, and none should — from the payer's seat this is a normal person paying a normal
    // shop, and the entire marketplace behind it stays invisible.
    //
    // Fire-and-forget: an alert must never delay handing the user their unsigned transaction.
    void (async () => {
      try {
        const info = await getOrderAlertInfo(orderId);
        // sim_behavior NULL = a real person. Nobody to tell on a provider or simulated row.
        if (info?.merchant?.user_id && info.merchant.sim_behavior == null) {
          await alertOrderIncoming(info.merchant, info.amountFiat, info.currency);
        }
      } catch {
        /* best-effort */
      }
    })();
  }

  const order = await getOrderForUser(primaryId, userId);
  if (!order) return { error: 'quote_not_found' };
  return { ok: true, order, unsignedTx: built.unsignedTx, feePayer: built.feePayer, sponsored: built.sponsored, transferId, referenceCode: refs[0] };
}

/** pay_instructions → waiting_payment: the user broadcast the escrow-funding tx; record + advance
 *  every leg of the payment, since they all ride that one signature. */
export async function markFundSubmitted(orderId: string, userId: string): Promise<boolean> {
  const ids = await markGroupFundSubmitted(orderId, userId);
  for (const id of ids) await appendOrderEvent(id, 'pay_instructions', 'waiting_payment', 'fund_submitted');
  return ids.length > 0;
}

/** Called by the confirmer when any escrow transfer confirms on-chain; advances the linked order(s). */
/**
 * A funded leg becomes a live order. Shared by the two ways funding is learned: the deposit
 * transfer confirming (onTransferConfirmed) and a deposit attributed by its memo (attachDepositByMemo).
 * The CAS is what makes the two safe to race.
 */
async function advanceFundedLeg(
  f: { id: string; state: OrderState; sim_behavior: string | null },
  event: 'fund_confirmed' | 'fund_reconciled',
): Promise<void> {
  // A funded deposit is authoritative from waiting_payment, pay_instructions (the user's /fund-submit
  // never arrived) AND failed (expired as unfunded before the money was seen — otherwise the escrow
  // holds USDC while the order is a dead end).
  if (!(await casOrderState(f.id, ['waiting_payment', 'pay_instructions', 'failed'], 'payment_detected'))) return;
  // Three claim clocks: a real merchant (sim_behavior NULL) is a person who has to open a banking
  // app — the human-sized SLA; a provider-driven platform row ('psp') is a vendor disbursement
  // that outlives 30s but not minutes; everything else is a sim worker reacting in one tick.
  const slaMs = f.sim_behavior == null ? MERCHANT_CLAIM_MS : f.sim_behavior === 'psp' ? PROVIDER_SLA_MS : ORDER_SLA_MS;
  // The same split decides whether this order is OFFERED at all (0015).
  //
  // A human-LP order becomes lockable now: the LP routing picked holds it exclusively until
  // offer_widens_at, then anyone eligible can take it. A provider- or sim-settled order is born
  // LOCKED — its merchant row is the settler, no pool was ever consulted, and nobody else may
  // touch it. That uniformity is what lets claimOrderPayout require a lock with one predicate
  // instead of carving out an exception for the psp caller.
  const offered = f.sim_behavior == null;
  const now = Date.now();
  await updateOrder(f.id, {
    expiresAt: new Date(now + slaMs),
    lockedAt: offered ? null : new Date(now),
    offerWidensAt: offered ? new Date(now + HEAD_START_MS) : null,
  });
  await appendOrderEvent(f.id, f.state, 'payment_detected', event);
  if (offered) await alertMerchantOrderReady(f.id);
}

export async function onTransferConfirmed(transferId: string): Promise<void> {
  const funded = await listOrdersByEscrowFundTransfer(transferId);
  if (funded.length) {
    // One signature funds every leg of a payment, so one confirmation advances them all.
    for (const f of funded) await advanceFundedLeg(f, 'fund_confirmed');
    return;
  }
  // A settlement tx landed — a release or a refund. Usually the order already reflects it (the
  // broadcaster waited for this and wrote the state itself); the cases that matter are the ones
  // where it did not: the tx landed after the bounded wait gave up, so the order is still sitting
  // in merchant_confirms (release) or back in payment_detected (refund). The row's note says which.
  const settled = await getOrderByEscrowReleaseTransfer(transferId);
  if (!settled) return;
  const terminal: OrderState[] = ['completed', 'refunded', 'failed'];
  if (terminal.includes(settled.state)) return;
  if (settled.note === 'refund') {
    if (!(await casOrderState(settled.id, ['payment_detected', 'merchant_confirms'], 'refunded'))) return;
    await updateOrder(settled.id, { resolution: null, expiresAt: null });
    await appendOrderEvent(settled.id, settled.state, 'refunded', 'refunded_late');
    await markLatestAttemptOutcome(settled.id, 'failed');
    metrics.inc('orders_refunded');
    if (settled.to_user_id) await notifyRefunded(settled.to_user_id, Number(settled.amount_usdc));
    await notifyGroupSettled(settled.id);
    return;
  }
  if (settled.state !== 'funds_released') {
    if (!(await casOrderState(settled.id, ['payment_detected', 'merchant_confirms'], 'funds_released'))) return;
    await appendOrderEvent(settled.id, settled.state, 'funds_released', 'funds_released_late');
    await markLatestAttemptOutcome(settled.id, 'released');
  }
  await updateOrder(settled.id, { state: 'completed', expiresAt: null });
  await appendOrderEvent(settled.id, 'funds_released', 'completed', 'completed');
  metrics.inc('orders_completed'); // M6
  await notifyGroupSettled(settled.id); // M6
}

/**
 * The deposit that landed but the DB never saw: a /fund-submit call that dropped after the payer
 * signed, so the row has no signature and nothing ever asks the chain about it. The Helius webhook
 * is the first line — the fee-payer co-signs every deposit, so every one is pushed to
 * routes/webhooks.ts, which attributes it by memo through attachDepositByMemo. This is the backstop,
 * and it costs nothing at idle: the pool's history is read only while a signature-less row waits.
 */
export async function reconcilePoolDeposits(log?: (m: string) => void): Promise<void> {
  const waiting = await listUnattributedDeposits(24);
  if (waiting.length === 0) return;
  const poolAta = await getAssociatedTokenAddress(usdcMint(), new PublicKey(escrowPoolAddress()));
  const recent = await connection().getSignaturesForAddress(poolAta, { limit: 25 }, 'confirmed');
  for (const { signature } of recent) {
    if (seenPoolSignatures.has(signature)) continue;
    try {
      const reference = await attachDepositByMemo(signature);
      seenPoolSignatures.add(signature);
      if (reference) log?.(`deposit ${signature.slice(0, 8)}… is order ${reference}'s → signature attached (reconciled)`);
    } catch (e) {
      log?.(`reconcile ${signature.slice(0, 8)}…: ${String(e)}`);
    }
  }
}
// ponytail: grows with pool traffic (~0.03 tx/tick at pilot load); an LRU when the pilot is not one.
const seenPoolSignatures = new Set<string>();

/**
 * Bind a chain signature to the waiting deposit row its memo names. Returns the reference on success;
 * null when the tx is not a memo'd deposit we are waiting for (already ours, failed, no memo, or no
 * signature-less escrow_fund row under that reference). Verification is NOT done here: the row only
 * gains its signature, and the confirmer asks the chain about it exactly as if the client had posted it.
 */
export async function attachDepositByMemo(signature: string): Promise<string | null> {
  if (await getTransferBySignature(signature)) return null;
  const tx = await connection().getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  if (!tx || tx.meta?.err) return null;
  const memo = memoOf(tx.transaction.message.instructions.filter((ix): ix is ParsedInstruction => 'parsed' in ix));
  if (!memo || !/^PAY-[0-9A-F]{8}$/.test(memo)) return null;
  return (await attachSignatureByReference(memo, signature)) ? memo : null;
}

/** "You paid X" once per PAYMENT, not once per leg: fires when the last leg has settled either way,
 *  for the sum that actually reached the receiver. A refunded leg announces itself separately. */
async function notifyGroupSettled(orderId: string): Promise<void> {
  const g = await getGroupSettlement(orderId);
  if (g?.allTerminal && g.completedUsdc > 0) await notifyPaymentSent(g.userId, g.completedUsdc);
}


/** The confirmer AND the Helius webhook both funnel a confirmed transfer through here: advance any
 *  linked order, then notify the recipient of a P2P send. Keeps both confirmation paths in sync. */
export async function onTransferConfirmedAndNotify(transferId: string): Promise<void> {
  await onTransferConfirmed(transferId);
  // Merchant stake deposits land here too — a plain send whose recipient is the stake treasury.
  // No-op for everything else. Credited on confirmation, never on submit.
  await creditStakeOnConfirm(transferId, config.stakeTreasuryAddress);
  // Cross-chain companion legs (docs/19): outbound burn confirmed → start attestation; inbound
  // mint confirmed → settled. No-op for non-bridge transfers.
  await onBridgeCompanionConfirmed(transferId);
  const recv = await getSendNotifyInfo(transferId);
  if (recv) await notifyReceived(recv.toUserId, recv.amountUsd, recv.fromHandle);
}

/**
 * Tell the LP an order they can take is live. Split out so the funding path stays readable and so
 * every alert goes through one place that knows to skip the rows with no human behind them.
 */
async function alertMerchantOrderReady(orderId: string): Promise<void> {
  try {
    const info = await getOrderAlertInfo(orderId);
    if (info?.merchant?.user_id) await alertOrderReady(info.merchant, info.amountFiat, info.currency, orderId);
  } catch {
    /* best-effort: an LP we couldn't reach is what the escalation ladder is for */
  }
}

/**
 * Reclaim locks that ran out unpaid, put the orders back in the pool, and record who dropped them.
 *
 * Runs inside the existing 8s worker tick rather than as a sixth setInterval — the loops in
 * server.ts are already unguarded against a second replica (docs/10: single-instance by design),
 * and adding another timer would add another thing to make safe later.
 *
 * The abandonment count is read off the append-only event log, so there is no counter to decay and
 * the ban is derivable from history. Note what this bans: LOCKING, not routing, and it never
 * touches the bond. Forgetting an order is not defaulting on one.
 */
export async function sweepExpiredLocks(log?: (m: string) => void): Promise<void> {
  const expired = await expireOrderLocks();
  for (const o of expired) {
    await appendOrderEvent(o.id, 'payment_detected', 'payment_detected', 'lock_expired', {
      merchantId: o.merchant_id,
    });
    log?.(`order ${o.reference_code} lock expired → back to the pool`);
    try {
      const info = await getOrderAlertInfo(o.id);
      if (info?.merchant?.user_id) await alertLockLost(info.merchant, o.reference_code);
      const abandons = await countRecentLockAbandons(o.merchant_id, LOCK_ABANDON_WINDOW_H);
      if (abandons >= LOCK_ABANDON_LIMIT) {
        await setLockBan(o.merchant_id, LOCK_BAN_MINUTES);
        log?.(`merchant ${o.merchant_id} locked out of locking (${abandons} abandons/${LOCK_ABANDON_WINDOW_H}h)`);
      }
    } catch {
      /* best-effort — reclaiming the order is the part that matters */
    }
  }
}

/** Overlay a transient resolution (delayed / needs_action / under_review) without leaving the state. */
export async function flagResolution(
  orderId: string,
  fromState: OrderState,
  resolution: OrderResolution,
  event: string,
): Promise<void> {
  await updateOrder(orderId, { resolution, expiresAt: new Date(Date.now() + ORDER_SLA_MS) });
  await appendOrderEvent(orderId, fromState, fromState, event, { resolution });
}

type SettleOutcome = 'confirmed' | 'failed' | 'pending' | 'in_flight' | 'already_settled';

/**
 * Broadcast an escrow settlement — a release or a refund — and wait, bounded, for it to land.
 *
 * The rule this enforces: an order with a settlement tx in flight never broadcasts another. Before
 * 2026-08-30 release wrote funds_released and refund wrote refunded on the SIGNATURE, not on the
 * landing, so a tx that dropped after broadcast left a "settled" order with USDC still in the pool
 * that nothing ever looked at again.
 *
 * - an earlier tx recorded and younger than SETTLE_DROPPED_MS → 'in_flight': nothing is sent; the
 *   confirmer finishes it from its row when it lands (onTransferConfirmed)
 * - an earlier tx older than that → the chain's HISTORY is asked (getTransferStatus): landed ⇒ still
 *   'in_flight' — the confirmer's next tick flips its row and finishes the order, and nothing is
 *   re-broadcast; failed or unknown ⇒ written off as dropped and a new tx goes out. Age alone is not
 *   a guard; age + "the chain has no record of it" is, because a blockhash older than ~151 blocks
 *   (60–90 s) is no longer processed and no durable nonce exists here (docs/16). This is what the
 *   escrow PDA being closed used to answer for free.
 * - a CONFIRMED settlement row → 'already_settled': a second payout never leaves the pool
 * - a FAILED settlement row (an on-chain error at the tail of this function, or the confirmer's
 *   verifier refusing it) is left behind by the retry the same way a dropped one is: named in a
 *   `settle_dropped` event carrying its id, so the order can always reach every leg it ever sent
 * - otherwise broadcast, record the row FIRST (the signature must survive whatever happens next),
 *   then wait: 'confirmed' / 'failed' (on-chain error) / 'pending' (unknown after the wait)
 */
async function settleEscrow(input: {
  orderId: string;
  fromState: OrderState;
  reference: string;
  send: () => Promise<string>;
  record: (signature: string) => Promise<{ id: string }>;
}): Promise<SettleOutcome> {
  const prior = await getEscrowReleaseTransfer(input.orderId);
  if (prior?.status === 'confirmed') return 'already_settled';
  if (prior) {
    if (prior.status === 'pending') {
      if (Date.now() - prior.created_at.getTime() < SETTLE_DROPPED_MS) return 'in_flight';
      if (prior.signature && (await getTransferStatus(prior.signature)) === 'confirmed') return 'in_flight';
      await setTransferStatus(prior.id, 'failed');
    }
    // Name the row the pointer is about to leave, whatever failed it. Before 2026-09-05 only the
    // age path above wrote this event; a row failed on-chain (below) or by the verifier matched
    // neither branch, the retry overwrote escrow_release_transfer_id, and nothing referenced it
    // again. The admin's order page reaches every settlement leg through these events (docs/07).
    await appendOrderEvent(input.orderId, input.fromState, input.fromState, 'settle_dropped', { transferId: prior.id, signature: prior.signature });
  }
  const signature = await input.send();
  const { id } = await input.record(signature);
  await updateOrder(input.orderId, { escrowReleaseTransferId: id });
  const landed = await confirmSignature(signature, SETTLE_CONFIRM_MS);
  if (landed === 'failed') await setTransferStatus(id, 'failed');
  return landed;
}

/**
 * payment_detected → merchant_confirms → funds_released: the LP confirmed the fiat payout, so
 * release the escrowed USDC to the merchant treasury. funds_released is written only once the
 * release tx has LANDED; the release transfer confirming then advances the order to completed
 * (onTransferConfirmed). An unconfirmed broadcast leaves the order in merchant_confirms with its
 * tx recorded — the confirmer completes it when it lands, or it is written off after
 * SETTLE_DROPPED_MS and the worker retries.
 */
export async function releaseToMerchant(input: {
  orderId: string;
  reference: string;
  amountUsdc: number;
  treasuryAddress: string;
  /** The partner's user — the row's to_user_id, so a payout the chain contradicts has someone to write a risk_event against. */
  merchantUserId: string | null;
}): Promise<void> {
  // Atomically claim the order so two workers can't both release it.
  const claimed = await casOrderState(input.orderId, ['payment_detected'], 'merchant_confirms');
  if (!claimed) return;

  // The pool holds the gross deposit (fee inside). Release pays the partner amount − fee and the
  // earnings wallet the fee in ONE tx; the row records the partner's leg — that is what the
  // verifier checks — and the fee leg has no row of its own (accepted, docs/16).
  const platformFee = await getOrderPlatformFee(input.orderId);
  const partnerAmount = formatAmount(amt(input.amountUsdc).minus(platformFee), USDC_DECIMALS);
  const outcome = await settleEscrow({
    orderId: input.orderId,
    fromState: 'merchant_confirms',
    reference: input.reference,
    send: () => sendFromEscrowPool({ toOwner: input.treasuryAddress, amountUsd: partnerAmount, feeUsd: platformFee }),
    record: (signature) =>
      recordEscrowTransfer({
        fromAddress: escrowPoolAddress(),
        toAddress: input.treasuryAddress,
        toUserId: input.merchantUserId,
        amountUsd: Number(partnerAmount),
        kind: 'escrow_release',
        signature,
        note: 'order release',
      }),
  });
  switch (outcome) {
    case 'confirmed':
      await updateOrder(input.orderId, { state: 'funds_released' });
      await appendOrderEvent(input.orderId, 'payment_detected', 'merchant_confirms', 'merchant_payout_confirmed');
      await appendOrderEvent(input.orderId, 'merchant_confirms', 'funds_released', 'funds_released');
      await markLatestAttemptOutcome(input.orderId, 'released'); // M3: close the routing audit trail
      return;
    case 'failed':
      // Rejected on-chain: nothing moved. Hand the order back for the worker to retry.
      await casOrderState(input.orderId, ['merchant_confirms'], 'payment_detected');
      await appendOrderEvent(input.orderId, 'merchant_confirms', 'payment_detected', 'release_failed');
      return;
    default:
      // pending / in_flight / already_settled: the order stays in merchant_confirms with a tx the
      // confirmer will finish from its row. Nothing to write but the fact.
      await appendOrderEvent(input.orderId, 'merchant_confirms', 'merchant_confirms', `release_${outcome}`);
  }
}

/**
 * Terminal refund: return the escrowed USDC to the user and mark the order refunded (made whole) —
 * refunded is written only once the refund tx has LANDED. Until then the order is handed back to
 * payment_detected for the worker to retry, and the in-flight guard in settleEscrow keeps the retry
 * from broadcasting a second tx; a late landing is finished by the confirmer from the row.
 */
export async function refundToUser(input: {
  orderId: string;
  userId: string;
  reference: string;
  amountUsdc: number;
}): Promise<boolean> {
  const wallet = await getWalletForUser(input.userId);
  if (!wallet?.address) return false;

  // Atomically claim the order BEFORE broadcasting — mutually exclusive with releaseToMerchant's CAS
  // from payment_detected, so a concurrent release + refund can't both broadcast; settleEscrow's
  // shared settlement pointer + status check is the single-settle guard behind it (docs/16).
  const claimed = await casOrderState(input.orderId, ['payment_detected'], 'refunded');
  if (!claimed) return false;

  let outcome: SettleOutcome;
  try {
    outcome = await settleEscrow({
      orderId: input.orderId,
      fromState: 'refunded',
      reference: input.reference,
      // Make-whole: the whole deposit back from the pool — the fee is inside it and never left.
      send: () => sendFromEscrowPool({ toOwner: wallet.address, amountUsd: input.amountUsdc }),
      record: (signature) =>
        recordEscrowTransfer({
          fromAddress: escrowPoolAddress(),
          toAddress: wallet.address,
          toUserId: input.userId,
          amountUsd: input.amountUsdc,
          kind: 'escrow_release',
          signature,
          note: 'refund',
        }),
    });
  } catch (e) {
    // Broadcast failed after claiming — revert so the worker can retry; don't leave a refunded order
    // with no on-chain refund.
    await casOrderState(input.orderId, ['refunded'], 'payment_detected');
    throw e;
  }
  if (outcome !== 'confirmed') {
    await casOrderState(input.orderId, ['refunded'], 'payment_detected');
    await appendOrderEvent(input.orderId, 'refunded', 'payment_detected', `refund_${outcome}`);
    return false;
  }
  await updateOrder(input.orderId, { resolution: null, expiresAt: null });
  await appendOrderEvent(input.orderId, 'payment_detected', 'refunded', 'refunded');
  await markLatestAttemptOutcome(input.orderId, 'failed'); // M3: the final LP didn't deliver
  metrics.inc('orders_refunded'); // M6
  await notifyRefunded(input.userId, input.amountUsdc); // M6
  // If this was the last open leg of a split whose other parts DID reach the receiver, those are
  // announced now — their completion held off because this leg was still in flight.
  await notifyGroupSettled(input.orderId);
  return true;
}

/**
 * Resolve a dispute + settle its side effects — the ONE implementation shared by the admin console
 * and the dev /sim route. Upheld: fine the LP's bond and refund the payer; rejected: un-freeze the
 * escrow so the next worker tick releases. The atomic resolveDispute CAS gates the bond draw, so two
 * concurrent calls can't fine the bond twice for one dispute.
 */
export async function settleDispute(
  disputeId: string,
  resolution: 'upheld' | 'rejected',
): Promise<'upheld' | 'rejected' | 'already_resolved' | null> {
  const dispute = await getDisputeRow(disputeId);
  if (!dispute) return null;
  if (dispute.status !== 'open') return 'already_resolved';
  if (!(await resolveDispute(disputeId, resolution))) return 'already_resolved';

  // The order was frozen mid-flight by the dispute; resolving it has to unfreeze the escrow too,
  // or the money sits in the pool forever. (A dispute opened on an already-completed order has
  // no escrow left to move — the refund branch simply finds no claimable state.)
  const order = await getOrderSimRow(dispute.orderId);
  if (resolution === 'upheld') {
    if (dispute.merchantSimBehavior === 'psp') {
      // Platform settlement row (docs/23): the platform fining its own bond is fiction, and the
      // only bond top-up path is user_id-gated — a drawn platform row could never recover and the
      // corridor would strand. The platform simply eats the double loss (payer refunded below,
      // fiat already went out); the risk_events row is the record the admin dashboard surfaces.
      if (order) {
        await insertRiskEvent({
          userId: order.userId,
          kind: 'provider_dispute_upheld',
          amountUsd: order.amountUsdc,
          decision: 'review',
          score: 0,
          reason: `dispute ${disputeId} upheld on provider order ${order.reference} — platform absorbs the loss`,
          counterparty: dispute.merchantId,
        });
      }
    } else {
      // min(bond, the order's amount) — order-sized, bond-bounded (merchantStats.ts). The clamp in
      // drawDownBond is the rule; the ledger records what was actually drawn.
      await drawDownBond(dispute.merchantId, order?.amountUsdc ?? 0, disputeId);
    }
    if (order && order.state === 'payment_detected') {
      await refundToUser({
        orderId: order.id,
        userId: order.userId,
        reference: order.reference,
        amountUsdc: order.amountUsdc,
      });
    }
  } else if (order && order.state === 'payment_detected') {
    // Merchant cleared → un-freeze with a past deadline so the next worker tick releases.
    await unfreezeOrderAfterDispute(order.id);
  }
  return resolution;
}

/**
 * M3 auto-failover: a stalled order (still payment_detected, escalated to under_review past its SLA) is
 * silently re-routed to the next-best LP instead of refunding. Returns true if it claimed a reroute;
 * false → the caller should refund (no candidates left or the attempt cap is reached). The escrowed
 * USDC is untouched — only the release target changes — so no new deposit and no on-chain change.
 */
export async function rerouteOrder(input: {
  orderId: string;
  payoutMethod: PayoutMethod;
  amountUsdc: number;
  /** The order's CURRENT merchant_id, read from the row itself.
   *
   *  It used to come from `attempts.at(-1)`, on the assumption that the last routing attempt always
   *  names the order's merchant. The lock broke that: lockOrder rewrites merchant_id when a pool LP
   *  takes an order and writes no attempt row, so after any pool lock the two disagree — the CAS
   *  below matched zero rows, rerouteOrder returned false, and the worker REFUNDED the payer while
   *  the locking LP was still holding a live lock and paying the fiat leg. */
  currentMerchantId: string | null;
  /** Who the fiat is for — the pair rule excludes any LP who has paid them recently or holds a
   *  sibling leg to them, so a failover can't land where routing would never have gone. */
  payee: string | null;
}): Promise<boolean> {
  const attempts = await listRoutingAttempts(input.orderId);
  const sequence = attempts.length ? Math.max(...attempts.map((a) => a.sequence)) : 0;
  const currentMerchantId = input.currentMerchantId;
  if (sequence >= MAX_ROUTING_ATTEMPTS || !currentMerchantId) {
    metrics.inc('routing_reroute_exhausted'); // M6: give up → the caller refunds
    return false;
  }

  const tried = attempts.map((a) => a.merchantId);
  const ranked = await rankMerchants({
    payoutMethod: input.payoutMethod,
    amountUsdc: input.amountUsdc,
    excludeIds: tried,
    payee: input.payee,
  });
  const next = ranked[0]?.merchant;
  if (!next) {
    metrics.inc('routing_reroute_exhausted'); // M6: no fresh LP can cover it → the caller refunds
    return false;
  }

  // Atomically reassign while still in payment_detected AND still pointing at the stalled LP — so two
  // concurrent ticks can't both claim. Lost the race → bail.
  const claimed = await reassignOrderMerchant(
    input.orderId,
    next.id,
    new Date(Date.now() + ORDER_SLA_MS),
    currentMerchantId,
    new Date(Date.now() + HEAD_START_MS),
  );
  if (!claimed) return false;

  await markLatestAttemptOutcome(input.orderId, 'failed'); // the LP we just left
  await insertRoutingAttempt({ orderId: input.orderId, merchantId: next.id, sequence: sequence + 1, outcome: 'rerouted', reason: 'failover' });
  await appendOrderEvent(input.orderId, 'payment_detected', 'payment_detected', 'rerouted', { toMerchant: next.name });
  // The new LP gets the same push the original got at fund-confirm — without it their fresh head
  // start ticked away against a merchant who could only find the order by polling.
  await alertMerchantOrderReady(input.orderId).catch(() => {});
  metrics.inc('routing_reroute'); // M6
  return true;
}
