// orderMachine.ts — the order state machine (stablecoin-onofframp-architecture.pdf, page 2).
// Happy path: quote_locked → pay_instructions → waiting_payment → payment_detected →
// merchant_confirms → funds_released → completed. Failure branches overlay a transient resolution
// (delayed / needs_action / under_review) and terminate at refunded. All escrow movement is real
// on devnet (backend-custodied; M2 swaps in an on-chain PDA program); the simulated merchant/LP and
// escalation timers live in simMerchant.ts.
import { randomBytes } from 'node:crypto';

import type { Order, OrderResolution, OrderState, PayoutMethod } from '@fpay/shared';

import { config } from '../envConfig';
import { amt, USDC_DECIMALS } from '../lib/amount';
import { formatAmount } from '../lib/units';
import {
  appendOrderEvent,
  casOrderState,
  countRecentLockAbandons,
  createPendingTransfer,
  creditStakeOnConfirm,
  drawDownBond,
  expireOrderLocks,
  getOrderAlertInfo,
  setLockBan,
  getDisputeRow,
  getOrderByEscrowFundTransfer,
  getOrderByEscrowReleaseTransfer,
  getOrderForUser,
  getOrderPlatformFee,
  getOrderSimRow,
  getOrderUserAmount,
  getQuoteRowForUser,
  getSendNotifyInfo,
  getWalletForUser,
  insertOrder,
  insertRiskEvent,
  insertRoutingAttempt,
  listRoutingAttempts,
  markLatestAttemptOutcome,
  reassignOrderMerchant,
  recordEscrowTransfer,
  resolveDispute,
  unfreezeOrderAfterDispute,
  updateOrder,
} from '../db/queries';

import { alertLockLost, alertOrderIncoming, alertOrderReady } from './alert';
import { onBridgeCompanionConfirmed } from './bridge/machine';
import { checkCashOutLimit, scoreAndRecord, type LimitCheck } from './compliance';
import { buildDepositTx, escrowAddress, refundEscrow, releaseEscrow } from './escrowProgram';
import { DISPUTE_PENALTY_USDC } from './merchantStats';
import { metrics } from './metrics';
import { notifyPaymentSent, notifyReceived, notifyRefunded } from './notify';
import { rankMerchants } from './routing';

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

/** M3: cap on routing attempts per order (initial assignment + up to 2 reroutes) before refunding. */
export const MAX_ROUTING_ATTEMPTS = 3;

/**
 * How long the LP routing picked holds an order exclusively before the rest of the eligible pool
 * can take it. This IS the reward for ranking first — first refusal on every order, which costs the
 * platform nothing and is worth more to a good LP than any badge.
 *
 * Short on purpose. The payer is standing somewhere waiting, and a head start long enough to matter
 * to a sleeping LP is long enough to hurt them.
 */
export const HEAD_START_MS = 20_000;

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
  | { ok: true; order: Order; unsignedTx: string; feePayer: string; transferId: string; referenceCode: string }
  | { error: 'limit_exceeded'; limit: Extract<LimitCheck, { ok: false }> }
  | { error: 'quote_not_found' | 'quote_expired' | 'wallet_not_found' | 'solana_unavailable' };

/** quote_locked → pay_instructions: create the order + the unsigned escrow-funding tx for the user. */
export async function confirmOrderFromQuote(userId: string, quoteId: string): Promise<ConfirmResult> {
  const quote = await getQuoteRowForUser(quoteId, userId);
  if (!quote) return { error: 'quote_not_found' };
  if (quote.expiresAt.getTime() < Date.now()) return { error: 'quote_expired' };

  const wallet = await getWalletForUser(userId);
  if (!wallet?.address) return { error: 'wallet_not_found' };

  // M5: enforce cash-out KYC limits against the REAL amountUsdc here (the /orders/quote estimate is
  // only an early gate), using rolling in-flight volume — so a user can't bypass the cap by reusing or
  // stacking quotes. Also write the cash-out risk_event (the off-ramp leg had no audit trail).
  const lim = await checkCashOutLimit(userId, quote.amountUsdc);
  if (!lim.ok) return { error: 'limit_exceeded', limit: lim };
  await scoreAndRecord({ userId, kind: 'cash_out', amountUsd: quote.amountUsdc });

  const referenceCode = 'PAY-' + randomBytes(4).toString('hex').toUpperCase();

  // The escrow-funding tx: a program `deposit` (user signs as token authority, fee-payer sponsors).
  // Same prepare/submit shape as /transfer/prepare, so the web client signs it via the existing signer.
  let built;
  try {
    built = await buildDepositTx({
      userOwner: wallet.address,
      amountUsd: quote.amountUsdc,
      platformFeeUsd: quote.platformFeeUsdc,
      reference: referenceCode,
    });
  } catch {
    return { error: 'solana_unavailable' };
  }
  const escrowAddr = escrowAddress(referenceCode);

  const { id: transferId } = await createPendingTransfer({
    fromUserId: userId,
    toUserId: null,
    fromAddress: wallet.address,
    toAddress: escrowAddr,
    amountUsd: quote.amountUsdc,
    kind: 'escrow_fund',
    note: referenceCode,
  });

  const orderId = await insertOrder({
    userId,
    quoteId,
    merchantId: quote.merchantId,
    amountUsdc: quote.amountUsdc,
    referenceCode,
    state: 'pay_instructions',
    escrowFundTransferId: transferId,
    note: referenceCode,
  });
  await appendOrderEvent(orderId, null, 'quote_locked', 'quote_created');
  await appendOrderEvent(orderId, 'quote_locked', 'pay_instructions', 'confirm_order');
  // M3: record the initial LP assignment as routing attempt #1 (the failover audit trail + tried-set).
  if (quote.merchantId) {
    await insertRoutingAttempt({ orderId, merchantId: quote.merchantId, sequence: 1, outcome: 'assigned', reason: 'initial' });
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

  const order = await getOrderForUser(orderId, userId);
  if (!order) return { error: 'quote_not_found' };
  return { ok: true, order, unsignedTx: built.unsignedTx, feePayer: built.feePayer, transferId, referenceCode };
}

/** pay_instructions → waiting_payment: the user broadcast the escrow-funding tx; record + advance. */
export async function markFundSubmitted(orderId: string, userId: string): Promise<boolean> {
  const order = await getOrderForUser(orderId, userId);
  if (!order || order.state !== 'pay_instructions') return false;
  await updateOrder(orderId, { state: 'waiting_payment' });
  await appendOrderEvent(orderId, 'pay_instructions', 'waiting_payment', 'fund_submitted');
  return true;
}

/** Called by the confirmer when any escrow transfer confirms on-chain; advances the linked order. */
export async function onTransferConfirmed(transferId: string): Promise<void> {
  const funded = await getOrderByEscrowFundTransfer(transferId);
  // Advance from waiting_payment OR pay_instructions: a confirmed deposit is authoritative even if the
  // user's /fund-submit call dropped (otherwise the escrow funds while the order stays stuck → stranded).
  if (funded && (funded.state === 'waiting_payment' || funded.state === 'pay_instructions')) {
    // Three claim clocks: a real merchant (sim_behavior NULL) is a person who has to open a banking
    // app — the human-sized SLA; a provider-driven platform row ('psp') is a vendor disbursement
    // that outlives 30s but not minutes; everything else is a sim worker reacting in one tick.
    const slaMs =
      funded.sim_behavior == null ? MERCHANT_CLAIM_MS : funded.sim_behavior === 'psp' ? PROVIDER_SLA_MS : ORDER_SLA_MS;
    // The same split decides whether this order is OFFERED at all (0015).
    //
    // A human-LP order becomes lockable now: the LP routing picked holds it exclusively until
    // offer_widens_at, then anyone eligible can take it. A provider- or sim-settled order is born
    // LOCKED — its merchant row is the settler, no pool was ever consulted, and nobody else may
    // touch it. That uniformity is what lets claimOrderPayout require a lock with one predicate
    // instead of carving out an exception for the psp caller.
    const offered = funded.sim_behavior == null;
    const now = Date.now();
    await updateOrder(funded.id, {
      state: 'payment_detected',
      expiresAt: new Date(now + slaMs),
      lockedAt: offered ? null : new Date(now),
      offerWidensAt: offered ? new Date(now + HEAD_START_MS) : null,
    });
    await appendOrderEvent(funded.id, funded.state, 'payment_detected', 'fund_confirmed');
    if (offered) await alertMerchantOrderReady(funded.id);
    return;
  }
  const released = await getOrderByEscrowReleaseTransfer(transferId);
  if (released && released.state === 'funds_released') {
    await updateOrder(released.id, { state: 'completed', expiresAt: null });
    await appendOrderEvent(released.id, 'funds_released', 'completed', 'completed');
    metrics.inc('orders_completed'); // M6
    const info = await getOrderUserAmount(released.id);
    if (info) await notifyPaymentSent(info.userId, info.amountUsdc); // M6
  }
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

/**
 * payment_detected → merchant_confirms → funds_released: the LP confirmed the fiat payout, so
 * release the escrowed USDC to the merchant treasury. The release tx confirming on-chain advances
 * the order to completed (onTransferConfirmed).
 */
export async function releaseToMerchant(input: {
  orderId: string;
  reference: string;
  amountUsdc: number;
  treasuryAddress: string;
}): Promise<void> {
  // Atomically claim the order so the worker and a manual /sim call can't both release it.
  const claimed = await casOrderState(input.orderId, ['payment_detected'], 'merchant_confirms');
  if (!claimed) return;

  // Broadcast + record FIRST, then advance — a broadcast failure leaves the order in
  // merchant_confirms with no release tx, which the worker's recovery branch resets to retry.
  const signature = await releaseEscrow({ reference: input.reference, merchantOwner: input.treasuryAddress });
  // The vault only ever held the LP's portion — the platform's in-rate cut split off at deposit —
  // so the release transfer records amount − fee, not the order's full user debit.
  const platformFee = await getOrderPlatformFee(input.orderId);
  const { id: releaseTransferId } = await recordEscrowTransfer({
    fromAddress: escrowAddress(input.reference),
    toAddress: input.treasuryAddress,
    amountUsd: Number(formatAmount(amt(input.amountUsdc).minus(platformFee), USDC_DECIMALS)),
    kind: 'escrow_release',
    signature,
    note: 'order release',
  });
  await updateOrder(input.orderId, { state: 'funds_released', escrowReleaseTransferId: releaseTransferId });
  await appendOrderEvent(input.orderId, 'payment_detected', 'merchant_confirms', 'merchant_payout_confirmed');
  await appendOrderEvent(input.orderId, 'merchant_confirms', 'funds_released', 'funds_released');
  await markLatestAttemptOutcome(input.orderId, 'released'); // M3: close the routing audit trail
}

/** Terminal refund: return the escrowed USDC to the user and mark the order refunded (made whole). */
export async function refundToUser(input: {
  orderId: string;
  userId: string;
  reference: string;
  amountUsdc: number;
}): Promise<boolean> {
  const wallet = await getWalletForUser(input.userId);
  if (!wallet?.address) return false;

  // Atomically claim the order BEFORE broadcasting — mutually exclusive with releaseToMerchant's CAS
  // from payment_detected, so a concurrent release + refund can't both broadcast and diverge the DB
  // ledger from on-chain settlement. (The on-chain close is the ultimate single-settle guard; this
  // keeps our records consistent under concurrency too.)
  const claimed = await casOrderState(input.orderId, ['payment_detected'], 'refunded');
  if (!claimed) return false;

  let signature: string;
  try {
    // Make-whole: vault portion + the platform fee back from the fee-payer's ATA, one atomic tx.
    signature = await refundEscrow({
      reference: input.reference,
      userOwner: wallet.address,
      platformFeeUsd: await getOrderPlatformFee(input.orderId),
    });
  } catch (e) {
    // Broadcast failed after claiming — revert so the worker can retry; don't leave a refunded order
    // with no on-chain refund.
    await casOrderState(input.orderId, ['refunded'], 'payment_detected');
    throw e;
  }
  const { id: releaseTransferId } = await recordEscrowTransfer({
    fromAddress: escrowAddress(input.reference),
    toAddress: wallet.address,
    toUserId: input.userId,
    amountUsd: input.amountUsdc,
    kind: 'escrow_release',
    signature,
    note: 'refund',
  });
  await updateOrder(input.orderId, {
    resolution: null,
    expiresAt: null,
    escrowReleaseTransferId: releaseTransferId,
  });
  await appendOrderEvent(input.orderId, 'payment_detected', 'refunded', 'refunded');
  await markLatestAttemptOutcome(input.orderId, 'failed'); // M3: the final LP didn't deliver
  metrics.inc('orders_refunded'); // M6
  await notifyRefunded(input.userId, input.amountUsdc); // M6
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
  // or the money sits in the vault forever. (A dispute opened on an already-completed order has
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
      await drawDownBond(dispute.merchantId, DISPUTE_PENALTY_USDC); // fine the LP's bond
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
  if (sequence >= MAX_ROUTING_ATTEMPTS || !currentMerchantId) return false; // give up → refund

  const tried = attempts.map((a) => a.merchantId);
  const ranked = await rankMerchants({
    payoutMethod: input.payoutMethod,
    amountUsdc: input.amountUsdc,
    excludeIds: tried,
    payee: input.payee,
  });
  const next = ranked[0]?.merchant;
  if (!next) return false; // no fresh LP that can cover the order → refund

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
  return true;
}
