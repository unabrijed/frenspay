// orders.ts — M1 on/off-ramp order lifecycle (quote → escrow fund → release/refund), M4 merchant
// onboarding + disputes. The dev-only /sim controls that once drove the lifecycle by hand are gone:
// there is no testnet tier, so there is no tier where a hand-driven release moves anything but real
// USDC (2026-08-30).
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
  attachTransferSignature,
  cancelOrder,
  freezeOrderForDispute,
  getOrderForDispute,
  getOrderForUser,
  insertDispute,
  listLegsForUser,
  listOrdersForUser,
  setOrderFeedback,
  withUserLock,
} from '../db/queries';
import { fiatDecimals, positiveAmount } from '../lib/amount';
import { CORRIDORS } from '../lib/corridors';
import { checkCashOutLimit } from '../services/compliance';
import { getMidRate } from '../services/fxRate';
import { DISPUTE_CLAW_WINDOW_H } from '../services/merchantStats';
import { metrics } from '../services/metrics';
import { aggregateLegs } from '../lib/legs';
import { confirmOrderFromQuote, markFundSubmitted } from '../services/orderMachine';
import { createQuote } from '../services/quoteEngine';

// Same floor as the external-send rails (routes/money.ts MIN_EXTERNAL_SEND_USD): an on-chain escrow
// plus an LP payout for micro-amounts is dust-spam, and it's currency-blind — 0.01 INR and 1 IDR
// both price to a real, fundable USDC order without it (found by the prism skeptic pass).
const MIN_ORDER_USD = 1;

export async function registerOrderRoutes(app: FastifyInstance) {
  // Quote Engine: a locked rate+fee+ETA, valid 45s. Routing picks the best simulated merchant/LP.
  app.post<{ Body: QuoteRequest }>('/orders/quote', async (req, reply) => {
    // Payments are a capability (docs/16): without the escrow pool's key, the fee-payer and an
    // earnings address there is nothing a deposit could ever be paid out of. Twin on POST /orders.
    if (!config.escrowLive) return reply.code(503).send({ error: 'payments_unavailable' });
    const userId = requireUserId(req);
    const { direction, payoutDestination, payoutName } = req.body ?? ({} as QuoteRequest);
    // The RAIL is the currency authority (docs/21; never the user's country, never the QR's own
    // claim). A rail we can't price (no corridor/FX band) is refused here, not guessed at.
    const payoutMethod = req.body?.payoutMethod ?? 'UPI';
    const corridor = CORRIDORS[payoutMethod];
    if (!corridor) return reply.code(400).send({ error: 'unsupported_payout_method' });
    const currency = corridor.currency;
    // The fiat leg carries the currency's own minor unit (INR 2dp, IDR 0dp) — an amount with more
    // precision than the currency has is a bug in the caller, not something to round away.
    const amountFiat = positiveAmount(req.body?.amountInr, fiatDecimals(currency));
    if (amountFiat === null) return reply.code(400).send({ error: 'invalid_amount' });
    // WHO gets the fiat. The client parsed it out of a QR, but that's a hint — this is the trust
    // boundary, and a merchant/PSP will act on this string.
    const destination = payoutDestination?.trim().toLowerCase();
    if (destination && !corridor.destinationRe?.test(destination)) {
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
    if (!config.escrowLive) return reply.code(503).send({ error: 'payments_unavailable' });
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
    // A payment made in parts reads as one order: the primary (with its events) carries the
    // aggregate, and every leg rides along so the receipt can show each credit's reference.
    const legs = await listLegsForUser(order.id, userId);
    return { order: aggregateLegs(legs.length > 1 ? [order, ...legs.slice(1)] : [order]) };
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
      const order = await getOrderForDispute(req.params.id, userId, DISPUTE_CLAW_WINDOW_H);
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

}
