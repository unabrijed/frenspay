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
import { config } from '../config';
import {
  appendOrderEvent,
  attachTransferSignature,
  cancelOrder,
  drawDownBond,
  getDisputeRow,
  getOrderForDispute,
  getOrderForUser,
  getOrderSimRow,
  insertDispute,
  insertMerchantApplication,
  listOrdersForUser,
  resolveDispute,
  setMerchantKyb,
  updateOrder,
  withUserLock,
} from '../db/queries';
import { checkCashOutLimit } from '../services/compliance';
import { getMidRate } from '../services/fxRate';
import { DISPUTE_PENALTY_USDC, recomputeMerchantStats } from '../services/merchantStats';
import { metrics } from '../services/metrics';
import {
  confirmOrderFromQuote,
  flagResolution,
  markFundSubmitted,
  refundToUser,
  releaseToMerchant,
} from '../services/orderMachine';
import { createQuote } from '../services/quoteEngine';

export async function registerOrderRoutes(app: FastifyInstance) {
  // Quote Engine: a locked rate+fee+ETA, valid 45s. Routing picks the best simulated merchant/LP.
  app.post<{ Body: QuoteRequest }>('/orders/quote', async (req, reply) => {
    const userId = requireUserId(req);
    const { direction, amountInr, payoutMethod } = req.body ?? ({} as QuoteRequest);
    if (!amountInr || amountInr <= 0) return reply.code(400).send({ error: 'invalid_amount' });
    // M5: enforce cash-out (merchant-pay) KYC limits before pricing. Estimate USD from the live mid
    // rate (M7); blocks under-tier users.
    const cashLimit = await checkCashOutLimit(userId, amountInr / getMidRate());
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
      amountInr,
      payoutMethod: payoutMethod ?? 'UPI',
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

  // Onboarding: a prospective LP applies (KYB pending → offline until approved). Public.
  app.post<{ Body: { name?: string; payoutMethod?: PayoutMethod; treasuryAddress?: string } }>(
    '/merchants/apply',
    async (req, reply) => {
      const { name, payoutMethod, treasuryAddress } = req.body ?? {};
      const rail = payoutMethod ?? 'UPI';
      if (!name || !treasuryAddress) return reply.code(400).send({ error: 'missing_fields' });
      if (!['UPI', 'Pix', 'bank'].includes(rail)) return reply.code(400).send({ error: 'invalid_rail' });
      try {
        new PublicKey(treasuryAddress); // release target — must be a valid Solana address
      } catch {
        return reply.code(400).send({ error: 'invalid_treasury_address' });
      }
      const id = await insertMerchantApplication({ name, payoutRail: rail, treasuryAddress });
      return reply.code(201).send({ id, kybStatus: 'pending' });
    },
  );

  // A user disputes a completed order, opening a dispute against the merchant who filled it.
  app.post<{ Params: { id: string }; Body: { reason?: string } }>('/orders/:id/dispute', async (req, reply) => {
    const userId = requireUserId(req);
    const order = await getOrderForDispute(req.params.id, userId);
    if (!order) return reply.code(404).send({ error: 'order_not_found' });
    if (order.state !== 'completed') return reply.code(409).send({ error: 'order_not_disputable' });
    let id: string;
    try {
      id = await insertDispute({ orderId: req.params.id, merchantId: order.merchantId, reason: req.body?.reason });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'already_disputed' });
      throw e;
    }
    return reply.code(201).send({ id, status: 'open' });
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
      const dispute = await getDisputeRow(req.params.id);
      if (!dispute) return reply.code(404).send({ error: 'dispute_not_found' });
      if (dispute.status !== 'open') return reply.code(409).send({ error: 'dispute_resolved' });
      const forUser = req.query.for !== 'merchant';
      // Gate the bond draw on the atomic resolve actually claiming the row — so two concurrent calls
      // can't fine the bond twice for one dispute.
      const resolved = await resolveDispute(req.params.id, forUser ? 'upheld' : 'rejected');
      if (!resolved) return reply.code(409).send({ error: 'dispute_resolved' });
      if (forUser) await drawDownBond(dispute.merchantId, DISPUTE_PENALTY_USDC); // fine the LP's bond
      return { ok: true, resolution: forUser ? 'upheld' : 'rejected' };
    },
  );
}
