// orderMachine.ts — the order state machine (stablecoin-onofframp-architecture.pdf, page 2).
// Happy path: quote_locked → pay_instructions → waiting_payment → payment_detected →
// merchant_confirms → funds_released → completed. Failure branches overlay a transient resolution
// (delayed / needs_action / under_review) and terminate at refunded. All escrow movement is real
// on devnet (backend-custodied; M2 swaps in an on-chain PDA program); the simulated merchant/LP and
// escalation timers live in simMerchant.ts.
import { randomBytes } from 'node:crypto';

import type { Order, OrderResolution, OrderState, PayoutMethod } from '@pay/shared';

import {
  appendOrderEvent,
  casOrderState,
  createPendingTransfer,
  getOrderByEscrowFundTransfer,
  getOrderByEscrowReleaseTransfer,
  getOrderForUser,
  getOrderState,
  getQuoteRowForUser,
  getWalletForUser,
  insertOrder,
  insertRoutingAttempt,
  listRoutingAttempts,
  markLatestAttemptOutcome,
  reassignOrderMerchant,
  recordEscrowTransfer,
  updateOrder,
} from '../db/queries';

import { checkCashOutLimit, scoreAndRecord, type LimitCheck } from './compliance';
import { buildDepositTx, escrowAddress, refundEscrow, releaseEscrow } from './escrowProgram';
import { rankMerchants } from './routing';

/** Time a stuck order sits in a state before the worker begins escalating it. Demo-tuned. */
export const ORDER_SLA_MS = 30_000;

/** M3: cap on routing attempts per order (initial assignment + up to 2 reroutes) before refunding. */
export const MAX_ROUTING_ATTEMPTS = 3;

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
    built = await buildDepositTx({ userOwner: wallet.address, amountUsd: quote.amountUsdc, reference: referenceCode });
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
  if (funded && funded.state === 'waiting_payment') {
    await updateOrder(funded.id, { state: 'payment_detected', expiresAt: new Date(Date.now() + ORDER_SLA_MS) });
    await appendOrderEvent(funded.id, 'waiting_payment', 'payment_detected', 'fund_confirmed');
    return;
  }
  const released = await getOrderByEscrowReleaseTransfer(transferId);
  if (released && released.state === 'funds_released') {
    await updateOrder(released.id, { state: 'completed', expiresAt: null });
    await appendOrderEvent(released.id, 'funds_released', 'completed', 'completed');
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
  const { id: releaseTransferId } = await recordEscrowTransfer({
    fromAddress: escrowAddress(input.reference),
    toAddress: input.treasuryAddress,
    amountUsd: input.amountUsdc,
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

  // Guard: only refund an order still awaiting payout. If it was already released or moved on (race with
  // a release / dev confirm / overlapping tick), don't broadcast a refund against an escrow that no
  // longer holds the funds. (The on-chain program is the ultimate guard; this avoids the wasted tx.)
  if ((await getOrderState(input.orderId)) !== 'payment_detected') return false;

  // Broadcast first; the program enforces single-refund (the escrow closes), so we set the terminal
  // state only after the on-chain refund is broadcast + recorded.
  const signature = await refundEscrow({ reference: input.reference, userOwner: wallet.address });
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
    state: 'refunded',
    resolution: null,
    expiresAt: null,
    escrowReleaseTransferId: releaseTransferId,
  });
  await appendOrderEvent(input.orderId, 'payment_detected', 'refunded', 'refunded');
  await markLatestAttemptOutcome(input.orderId, 'failed'); // M3: the final LP didn't deliver
  return true;
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
}): Promise<boolean> {
  const attempts = await listRoutingAttempts(input.orderId);
  const sequence = attempts.length ? Math.max(...attempts.map((a) => a.sequence)) : 0;
  const currentMerchantId = attempts.at(-1)?.merchantId; // the stalled LP (== orders.merchant_id)
  if (sequence >= MAX_ROUTING_ATTEMPTS || !currentMerchantId) return false; // give up → refund

  const tried = attempts.map((a) => a.merchantId);
  const ranked = await rankMerchants({ payoutMethod: input.payoutMethod, amountUsdc: input.amountUsdc, excludeIds: tried });
  const next = ranked[0]?.merchant;
  if (!next) return false; // no fresh LP that can cover the order → refund

  // Atomically reassign while still in payment_detected AND still pointing at the stalled LP — so two
  // concurrent ticks can't both claim. Lost the race → bail.
  const claimed = await reassignOrderMerchant(input.orderId, next.id, new Date(Date.now() + ORDER_SLA_MS), currentMerchantId);
  if (!claimed) return false;

  await markLatestAttemptOutcome(input.orderId, 'failed'); // the LP we just left
  await insertRoutingAttempt({ orderId: input.orderId, merchantId: next.id, sequence: sequence + 1, outcome: 'rerouted', reason: 'failover' });
  await appendOrderEvent(input.orderId, 'payment_detected', 'payment_detected', 'rerouted', { toMerchant: next.name });
  return true;
}
