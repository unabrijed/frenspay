// orders.ts — M1 on/off-ramp order lifecycle (quote → escrow fund → release/refund), M4 merchant
// onboarding + disputes, and the dev-only sim controls that drive the lifecycle by hand.
import type { FastifyInstance } from 'fastify';

import type {
  CreateOrderRequest,
  CreateOrderResponse,
  FundSubmitRequest,
  OrderResponse,
  OrdersResponse,
  PayoutMethod,
  QuoteRequest,
  QuoteResponse,
  SubmitTransferResponse,
} from '@fpay/shared';
import { PublicKey } from '@solana/web3.js';

import { requireUserId } from '../auth';
import { config } from '../envConfig';
import {
  appendOrderEvent,
  attachTransferSignature,
  cancelOrder,
  freezeOrderForDispute,
  getOrderForDispute,
  getOrderForUser,
  getOrderSimRow,
  insertDispute,
  listOrdersForUser,
  setMerchantKyb,
  setOrderFeedback,
  updateOrder,
  withUserLock,
} from '../db/queries';
import { fiatDecimals, positiveAmount } from '../lib/amount';
import { RAIL_CURRENCY } from '../lib/rails';
import { checkCashOutLimit } from '../services/compliance';
import { getMidRate } from '../services/fxRate';
import { recomputeMerchantStats } from '../services/merchantStats';
import { metrics } from '../services/metrics';
import {
  confirmOrderFromQuote,
  flagResolution,
  markFundSubmitted,
  refundToUser,
  releaseToMerchant,
  settleDispute,
} from '../services/orderMachine';
import { createQuote } from '../services/quoteEngine';

/**
 * A UPI VPA: local@psp, e.g. 'shop@okhdfcbank'. MIRRORS `VPA_RE` in packages/shared/src/payTarget.ts
 * — the backend can only `import type` from @fpay/shared (tsx won't transpile the workspace's raw
 * .ts), so shared runtime values are copied at the trust boundary rather than imported. Same
 * precedent as `canonicalHandle` / `normalizePhone` in db/queries.ts. `check-paytarget.ts` asserts
 * the two stay in step.
 *
 * The suffix forbids a dot: every real PSP/bank handle is a single label (okaxis, ybl, hdfcbank, …)
 * while an email domain has one. Without that, `someone@gmail.com` passed this gate and could be
 * quoted, escrowed, and handed to a merchant to pay by hand.
 */
const VPA_RE = /^[a-z0-9.\-_]{2,}@[a-z0-9\-_]{2,}$/i;

/**
 * Per-rail payout-destination gates — the ONLY validation between a scanned string and a human/PSP
 * acting on it. UPI = the VPA above. QRIS = the merchant proxy off the QR (NMID / merchant PAN):
 * shape varies by acquirer, so bound it to printable, non-@ (never a VPA by accident), sane length.
 * A rail with no entry here cannot take a destination at all.
 */
const DESTINATION_RE: Record<string, RegExp> = {
  UPI: VPA_RE,
  QRIS: /^(?!.*@)[a-z0-9][a-z0-9 .\-/]{4,63}$/i,
};

// Same floor as the external-send rails (routes/money.ts MIN_EXTERNAL_SEND_USD): an on-chain escrow
// plus an LP payout for micro-amounts is dust-spam, and it's currency-blind — 0.01 INR and 1 IDR
// both price to a real, fundable USDC order without it (found by the prism skeptic pass).
const MIN_ORDER_USD = 1;

export async function registerOrderRoutes(app: FastifyInstance) {
  // Quote Engine: a locked rate+fee+ETA, valid 45s. Routing picks the best simulated merchant/LP.
  app.post<{ Body: QuoteRequest }>('/orders/quote', async (req, reply) => {
    const userId = requireUserId(req);
    const { direction, payoutDestination, payoutName } = req.body ?? ({} as QuoteRequest);
    // The RAIL is the currency authority (docs/21; never the user's country, never the QR's own
    // claim). A rail we can't price (no corridor/FX band) is refused here, not guessed at.
    const payoutMethod = req.body?.payoutMethod ?? 'UPI';
    const currency = RAIL_CURRENCY[payoutMethod];
    if (!currency) return reply.code(400).send({ error: 'unsupported_payout_method' });
    // The fiat leg carries the currency's own minor unit (INR 2dp, IDR 0dp) — an amount with more
    // precision than the currency has is a bug in the caller, not something to round away.
    const amountFiat = positiveAmount(req.body?.amountInr, fiatDecimals(currency));
    if (amountFiat === null) return reply.code(400).send({ error: 'invalid_amount' });
    // WHO gets the fiat. The client parsed it out of a QR, but that's a hint — this is the trust
    // boundary, and a merchant/PSP will act on this string.
    const destination = payoutDestination?.trim().toLowerCase();
    if (destination && !DESTINATION_RE[payoutMethod]?.test(destination)) {
      return reply.code(400).send({ error: 'invalid_payout_destination' });
    }
    const estUsd = amountFiat / getMidRate(currency);
    if (estUsd < MIN_ORDER_USD) {
      return reply.code(400).send({ error: 'amount_too_small', minUsd: MIN_ORDER_USD });
    }
    // M5: enforce cash-out (merchant-pay) KYC limits before pricing. Estimate USD from the live mid
    // rate (M7); blocks under-tier users.
    const cashLimit = await checkCashOutLimit(userId, estUsd);
    if (!cashLimit.ok) {
      return reply.code(403).send({
        error: 'limit_exceeded',
        kind: cashLimit.kind,
        currentTier: cashLimit.currentTier,
        requiredTier: cashLimit.requiredTier,
        limitUsd: cashLimit.limitUsd,
        reason: cashLimit.reason,
      });
    }
    const quote = await createQuote(userId, {
      direction: direction === 'cash_out' ? 'cash_out' : 'spend',
      amountInr: amountFiat,
      currency,
      payoutMethod,
      payoutDestination: destination,
      payoutName: payoutName?.trim().slice(0, 80),
    });
    if ('error' in quote) return reply.code(503).send({ error: quote.error });
    return { quote } satisfies QuoteResponse;
  });

  // Confirm a quote → create the order + the unsigned escrow-funding tx (user signs via the client).
  app.post<{ Body: CreateOrderRequest }>('/orders', async (req, reply) => {
    const userId = requireUserId(req);
    const { quoteId } = req.body ?? ({} as CreateOrderRequest);
    if (!quoteId) return reply.code(400).send({ error: 'missing_fields' });
    // M6: serialize per user so concurrent confirms can't race the cash-out daily cap (the in-flight
    // volume read + order insert happen under the lock).
    const result = await withUserLock(userId, () => confirmOrderFromQuote(userId, quoteId));
    if ('error' in result) {
      if (result.error === 'limit_exceeded') {
        metrics.inc('limit_blocks');
        const l = result.limit;
        return reply.code(403).send({
          error: 'limit_exceeded',
          kind: l.kind,
          currentTier: l.currentTier,
          requiredTier: l.requiredTier,
          limitUsd: l.limitUsd,
          reason: l.reason,
        });
      }
      const code =
        result.error === 'quote_expired' ? 409 : result.error === 'solana_unavailable' ? 503 : 404;
      return reply.code(code).send({ error: result.error });
    }
    metrics.inc('orders_created');
    return {
      order: result.order,
      unsignedTx: result.unsignedTx,
      feePayer: result.feePayer,
      transferId: result.transferId,
      referenceCode: result.referenceCode,
    } satisfies CreateOrderResponse;
  });

  // Record the broadcast escrow-funding signature and advance pay_instructions → waiting_payment.
  app.post<{ Params: { id: string }; Body: FundSubmitRequest }>(
    '/orders/:id/fund-submit',
    async (req, reply) => {
      const userId = requireUserId(req);
      const { transferId, signature } = req.body ?? ({} as FundSubmitRequest);
      if (!transferId || !signature) return reply.code(400).send({ error: 'missing_fields' });
      let matched: boolean;
      try {
        matched = await attachTransferSignature(transferId, signature, userId);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'signature_exists' });
        throw e;
      }
      if (!matched) return reply.code(404).send({ error: 'transfer_not_found' });
      const advanced = await markFundSubmitted(req.params.id, userId);
      if (!advanced) return reply.code(409).send({ error: 'order_not_pending' });
      return { signature, status: 'pending' } satisfies SubmitTransferResponse;
    },
  );

  app.get<{ Params: { id: string } }>('/orders/:id', async (req, reply): Promise<OrderResponse | undefined> => {
    const userId = requireUserId(req);
    const order = await getOrderForUser(req.params.id, userId);
    if (!order) return reply.code(404).send({ error: 'order_not_found' });
    return { order };
  });

  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/orders',
    async (req): Promise<OrdersResponse> => {
      const userId = requireUserId(req);
      const page = await listOrdersForUser(userId, Number(req.query.limit ?? 50), req.query.cursor);
      return { orders: page.items, nextCursor: page.nextCursor };
    },
  );

  // Cancel an order whose escrow funding never completed (client signing failed/abandoned).
  app.post<{ Params: { id: string } }>('/orders/:id/cancel', async (req, reply) => {
    const userId = requireUserId(req);
    const ok = await cancelOrder(req.params.id, userId);
    if (!ok) return reply.code(404).send({ error: 'order_not_cancelable' });
    return { ok: true };
  });

  // --- dev-only simulated-merchant controls (drive the lifecycle by hand; disabled in prod) ---
  app.post<{ Params: { id: string } }>('/sim/orders/:id/merchant-confirm', async (req, reply) => {
    if (!config.isDevelopment) return reply.code(403).send({ error: 'sim_disabled' });
    const userId = requireUserId(req);
    const order = await getOrderSimRow(req.params.id);
    if (!order || order.userId !== userId) return reply.code(404).send({ error: 'order_not_found' });
    if (!order.treasuryAddress) return reply.code(409).send({ error: 'no_merchant' });
    if (order.state !== 'payment_detected' && order.state !== 'merchant_confirms') {
      return reply.code(409).send({ error: 'order_not_releasable' });
    }
    await releaseToMerchant({
      orderId: order.id,
      reference: order.reference,
      amountUsdc: order.amountUsdc,
      treasuryAddress: order.treasuryAddress,
    });
    return { ok: true, resolution: 'released' };
  });

  app.post<{ Params: { id: string }; Querystring: { reason?: string } }>(
    '/sim/orders/:id/fail',
    async (req, reply) => {
      if (!config.isDevelopment) return reply.code(403).send({ error: 'sim_disabled' });
      const userId = requireUserId(req);
      const order = await getOrderSimRow(req.params.id);
      if (!order || order.userId !== userId) return reply.code(404).send({ error: 'order_not_found' });
      if (order.state === 'completed' || order.state === 'refunded' || order.state === 'failed') {
        return reply.code(409).send({ error: 'order_terminal' });
      }
      const reason = req.query.reason ?? 'refund';
      if (reason === 'needs_action') {
        await flagResolution(order.id, order.state, 'needs_action', 'wrong_amount');
        return { ok: true, resolution: 'needs_action' };
      }
      if (reason === 'under_review') {
        await flagResolution(order.id, order.state, 'under_review', 'manual_review');
        return { ok: true, resolution: 'under_review' };
      }
      const ok = await refundToUser({
        orderId: order.id,
        userId: order.userId,
        reference: order.reference,
        amountUsdc: order.amountUsdc,
      });
      if (!ok) return reply.code(409).send({ error: 'refund_failed' });
      return { ok: true, resolution: 'refunded' };
    },
  );

  // M3 failover demo (dev only): force the assigned LP to fail NOW so the next worker tick re-routes
  // the order to the next-best LP — independent of which LP got picked.
  app.post<{ Params: { id: string } }>('/sim/orders/:id/merchant-fail', async (req, reply) => {
    if (!config.isDevelopment) return reply.code(403).send({ error: 'sim_disabled' });
    const userId = requireUserId(req);
    const order = await getOrderSimRow(req.params.id);
    if (!order || order.userId !== userId) return reply.code(404).send({ error: 'order_not_found' });
    if (order.state !== 'payment_detected') return reply.code(409).send({ error: 'order_not_failable' });
    // Escalate immediately: under_review + a past deadline → next tick hits rerouteOrder.
    await updateOrder(order.id, { resolution: 'under_review', expiresAt: new Date(Date.now() - 60_000) });
    await appendOrderEvent(order.id, 'payment_detected', 'payment_detected', 'merchant_fail_forced', {
      resolution: 'under_review',
    });
    return { ok: true, resolution: 'under_review' };
  });

  // --- M4: merchant lifecycle (onboarding KYB sim) + disputes ---
  // Onboarding (`POST /merchants/apply`) moved to routes/merchant.ts, where it is authenticated and
  // bound to a user — it used to be anonymous.

  // A user disputes a completed order, opening a dispute against the merchant who filled it.
  app.post<{ Params: { id: string }; Body: { reason?: string } }>('/orders/:id/dispute', async (req, reply) => {
    const userId = requireUserId(req);
    // Serialize against the worker: it re-reads the dispute INSIDE this same per-user lock before
    // releasing escrow, so "payer disputes" and "window closes" can't both win. Whoever takes the
    // lock first decides; if the worker got there, the re-check below sees a released state and 409s
    // (the payer can still dispute post-completion, which is the unchanged path).
    return withUserLock(userId, async () => {
      const order = await getOrderForDispute(req.params.id, userId);
      if (!order) return reply.code(404).send({ error: 'order_not_found' });
      // Disputable once the money is out of the payer's hands: either the order completed, or a real
      // merchant has CLAIMED to have paid and the release window is still running.
      const inReleaseWindow = order.state === 'payment_detected' && order.payoutClaimedAt != null;
      if (order.state !== 'completed' && !inReleaseWindow) {
        return reply.code(409).send({ error: 'order_not_disputable' });
      }
      let id: string;
      try {
        id = await insertDispute({ orderId: req.params.id, merchantId: order.merchantId, reason: req.body?.reason });
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'already_disputed' });
        throw e;
      }
      // Freeze the auto-release so a human decides. Nulling expires_at makes the worker's
      // `slaReached` permanently false, which disables BOTH the release and the reroute/refund
      // branches — no new state, no new worker code.
      if (inReleaseWindow) await freezeOrderForDispute(req.params.id);
      return reply.code(201).send({ id, status: 'open' });
    });
  });

  // One-tap 👍/👎 after completion — feeds the merchant's positive_rate. No withUserLock: the
  // guarded UPDATE in setOrderFeedback is the compare-and-set. 409 covers not-found / not-yours /
  // not-completed / already-answered alike; the client treats it as "already recorded".
  app.post<{ Params: { id: string }; Body: { up?: boolean } }>('/orders/:id/feedback', async (req, reply) => {
    const userId = requireUserId(req);
    if (typeof req.body?.up !== 'boolean') return reply.code(400).send({ error: 'missing_fields' });
    if (!(await setOrderFeedback(req.params.id, userId, req.body.up))) {
      return reply.code(409).send({ error: 'feedback_not_recorded' });
    }
    return { ok: true };
  });

  // --- dev-only M4 controls (KYB decision, stats recompute, dispute resolution) ---
  app.post<{ Params: { id: string }; Querystring: { decision?: string } }>(
    '/sim/merchants/:id/kyb',
    async (req, reply) => {
      if (!config.isDevelopment) return reply.code(403).send({ error: 'sim_disabled' });
      const decision = req.query.decision === 'reject' ? 'reject' : 'approve';
      const ok = await setMerchantKyb(req.params.id, decision);
      if (!ok) return reply.code(409).send({ error: 'not_pending' });
      return { ok: true, kybStatus: decision === 'approve' ? 'approved' : 'rejected' };
    },
  );

  app.post('/sim/merchants/recompute', async (req, reply) => {
    if (!config.isDevelopment) return reply.code(403).send({ error: 'sim_disabled' });
    await recomputeMerchantStats((m) => req.log.info(m));
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Querystring: { for?: string } }>(
    '/sim/disputes/:id/resolve',
    async (req, reply) => {
      if (!config.isDevelopment) return reply.code(403).send({ error: 'sim_disabled' });
      // Settlement logic (bond draw + refund/unfreeze) lives in orderMachine.settleDispute — the
      // same implementation the admin console uses, so the two can't drift.
      const result = await settleDispute(req.params.id, req.query.for !== 'merchant' ? 'upheld' : 'rejected');
      if (result === null) return reply.code(404).send({ error: 'dispute_not_found' });
      if (result === 'already_resolved') return reply.code(409).send({ error: 'dispute_resolved' });
      return { ok: true, resolution: result };
    },
  );
}
