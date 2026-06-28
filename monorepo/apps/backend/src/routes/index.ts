// Phase-1 Core API (backend-architecture.md §2).
// Read endpoints, Privy auth/sync, USDC transfers, and payment requests are all wired.
import type { FastifyInstance } from 'fastify';

import type {
  AuthSyncRequest,
  BalanceResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  CreateRequestRequest,
  FaucetRequest,
  FaucetResponse,
  FundSubmitRequest,
  MeResponse,
  NotificationsResponse,
  OrderResponse,
  OrdersResponse,
  PayoutMethod,
  PrepareTransferRequest,
  PrepareTransferResponse,
  QuoteRequest,
  QuoteResponse,
  RequestsResponse,
  ResolveHandleResponse,
  SubmitTransferRequest,
  SubmitTransferResponse,
  TransactionsResponse,
} from '@pay/shared';
import { PublicKey } from '@solana/web3.js';

import { authPreHandler, requirePrivyDid, requireUserId } from '../auth';
import { config } from '../config';
import {
  appendOrderEvent,
  attachTransferSignature,
  cancelOrder,
  cancelRequest,
  createPendingTransfer,
  createRequest,
  drawDownBond,
  findUserByHandle,
  findUserById,
  getDisputeRow,
  getOrderForDispute,
  getOrderForUser,
  getOrderSimRow,
  getUserKycTier,
  getWalletForUser,
  insertDispute,
  insertMerchantApplication,
  listOrdersForUser,
  listRequestsForUser,
  listTransactionsForUser,
  markRequestPaid,
  recordDeposit,
  resolveDispute,
  resolveHandleToFriend,
  getRequestNotifyInfo,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setMerchantKyb,
  setTransferStatusBySignature,
  setUserKycTier,
  unreadNotificationCount,
  updateOrder,
  upsertUserByPrivyDid,
  withUserLock,
} from '../db/queries';
import {
  checkCashOutLimit,
  checkSendLimit,
  scoreAndRecord,
  screenAddress,
  screenHandle,
} from '../services/compliance';
import { getMidRate, getMidRateAsOf } from '../services/fxRate';
import { metrics } from '../services/metrics';
import { notifyKycUpgraded, notifyRequestPaid } from '../services/notify';
import { rateLimitHook } from '../services/rateLimit';
import { DISPUTE_PENALTY_USDC, recomputeMerchantStats } from '../services/merchantStats';
import {
  confirmOrderFromQuote,
  flagResolution,
  markFundSubmitted,
  onTransferConfirmedAndNotify,
  refundToUser,
  releaseToMerchant,
} from '../services/orderMachine';
import { createQuote } from '../services/quoteEngine';
import { buildUsdcTransfer, getUsdcBalance, mintUsdcTo } from '../services/solana';

export async function registerRoutes(app: FastifyInstance) {
  // M6: rate-limit the sensitive routes (money movement + faucet + auth) before anything else runs.
  app.addHook('onRequest', rateLimitHook());

  // Identity: Privy bearer token in prod; x-dev-user-id shim when Privy is unconfigured.
  app.addHook('preHandler', authPreHandler);

  // M6: in-memory metrics (Prometheus text). Open by design — counters only, no PII.
  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return metrics.prometheus();
  });

  // M7: the live mid-market FX rate (for a standalone "today's rate" display; quotes carry their own).
  app.get('/fx/rate', async () => ({ rate: getMidRate(), asOf: getMidRateAsOf() }));

  // --- auth / identity ---
  app.post<{ Body: AuthSyncRequest }>('/auth/sync', async (req, reply) => {
    const privyDid = requirePrivyDid(req);
    const { handle, walletAddress } = req.body ?? ({} as AuthSyncRequest);
    if (!handle || !walletAddress) return reply.code(400).send({ error: 'missing_fields' });
    let user;
    try {
      user = await upsertUserByPrivyDid({ privyDid, handle, walletAddress });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'handle_taken' });
      throw e;
    }
    const wallet = await getWalletForUser(user.id);
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.display_name ?? user.handle,
      walletAddress: wallet?.address ?? walletAddress,
      kycTier: await getUserKycTier(user.id),
    } satisfies MeResponse;
  });

  app.get('/me', async (req, reply): Promise<MeResponse | undefined> => {
    const userId = requireUserId(req);
    const user = await findUserById(userId);
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    const wallet = await getWalletForUser(userId);
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.display_name ?? user.handle,
      walletAddress: wallet?.address ?? '',
      kycTier: await getUserKycTier(userId),
    };
  });

  // --- balance / activity ---
  app.get('/balance', async (req): Promise<BalanceResponse> => {
    const userId = requireUserId(req);
    const wallet = await getWalletForUser(userId);
    if (!wallet?.address) return { balanceUsd: 0 };
    return { balanceUsd: await getUsdcBalance(wallet.address) };
  });

  app.get('/transactions', async (req): Promise<TransactionsResponse> => {
    const userId = requireUserId(req);
    return { transactions: await listTransactionsForUser(userId) };
  });

  // --- users ---
  app.get<{ Querystring: { handle?: string } }>(
    '/users/resolve',
    async (req): Promise<ResolveHandleResponse> => {
      const handle = req.query.handle;
      if (!handle) return { user: null };
      return { user: await resolveHandleToFriend(handle) };
    },
  );

  // --- payment requests ---
  app.get('/requests', async (req): Promise<RequestsResponse> => {
    const userId = requireUserId(req);
    return { requests: await listRequestsForUser(userId) };
  });

  app.post<{ Body: CreateRequestRequest }>('/requests', async (req, reply) => {
    const userId = requireUserId(req);
    const { toHandle, amountUsd, note } = req.body ?? ({} as CreateRequestRequest);
    if (!amountUsd || amountUsd <= 0) return reply.code(400).send({ error: 'invalid_amount' });
    const to = toHandle ? await findUserByHandle(toHandle) : null;
    return createRequest({ fromUserId: userId, toUserId: to?.id ?? null, amountUsd, note });
  });

  // Resolve a request as paid, linking the transfer that fulfilled it. The payer (request's
  // addressee) makes the transfer via /transfer/prepare+submit first, then calls this with that id.
  app.post<{ Params: { id: string }; Body: { transferId?: string } }>(
    '/requests/:id/pay',
    async (req, reply) => {
      const userId = requireUserId(req);
      const { transferId } = req.body ?? {};
      if (!transferId) return reply.code(400).send({ error: 'missing_fields' });
      const ok = await markRequestPaid(req.params.id, userId, transferId);
      if (!ok) return reply.code(404).send({ error: 'request_not_found' });
      // M6: notify the requester that their request was paid.
      const info = await getRequestNotifyInfo(req.params.id);
      const payer = await findUserById(userId);
      if (info) await notifyRequestPaid(info.fromUserId, info.amountUsd, payer?.handle ?? 'Someone');
      return { ok: true };
    },
  );

  // Cancel an open request (requester only).
  app.post<{ Params: { id: string } }>('/requests/:id/cancel', async (req, reply) => {
    const userId = requireUserId(req);
    const ok = await cancelRequest(req.params.id, userId);
    if (!ok) return reply.code(404).send({ error: 'request_not_found' });
    return { ok: true };
  });

  // --- transfers (gas-sponsored USDC; user signs as token authority, fee-payer sponsors) ---
  app.post<{ Body: PrepareTransferRequest }>('/transfer/prepare', async (req, reply) => {
    const userId = requireUserId(req);
    const { toHandle, amountUsd, note } = req.body ?? ({} as PrepareTransferRequest);
    if (!amountUsd || amountUsd <= 0) return reply.code(400).send({ error: 'invalid_amount' });

    const fromWallet = await getWalletForUser(userId);
    if (!fromWallet?.address) return reply.code(404).send({ error: 'sender_wallet_not_found' });
    const to = toHandle ? await findUserByHandle(toHandle) : null;
    const toWallet = to ? await getWalletForUser(to.id) : null;
    if (!toWallet?.address) return reply.code(404).send({ error: 'recipient_not_found' });

    // M5 limits + screening, M6 serialized under a per-user advisory lock so the rolling daily-cap
    // check + the transfer insert can't be raced by two concurrent requests (closes the audit TOCTOU).
    const outcome = await withUserLock(userId, async () => {
      const limit = await checkSendLimit(userId, amountUsd);
      if (!limit.ok) return { kind: 'limit' as const, limit };
      // sanctions screening + fraud score (simulated) on BOTH parties (sender + recipient).
      const denylisted =
        (toHandle ? await screenHandle(toHandle) : false) ||
        (await screenAddress(toWallet.address)) ||
        (await screenAddress(fromWallet.address));
      const risk = await scoreAndRecord({ userId, kind: 'send', amountUsd, denylisted });
      if (risk.decision === 'block') return { kind: 'blocked' as const, reason: risk.reason };

      let built;
      try {
        built = await buildUsdcTransfer({ fromOwner: fromWallet.address, toOwner: toWallet.address, amountUsd });
      } catch (e) {
        // RPC down / misconfigured mint / blockhash fetch failed — surface as a clean 503.
        req.log.error({ err: e }, 'buildUsdcTransfer failed');
        return { kind: 'solana_unavailable' as const };
      }
      // Record the intent now so /transfer/submit only needs the transferId + signed tx.
      const { id: transferId } = await createPendingTransfer({
        fromUserId: userId,
        toUserId: to?.id ?? null,
        fromAddress: fromWallet.address,
        toAddress: toWallet.address,
        amountUsd,
        kind: 'send',
        note,
      });
      return { kind: 'ok' as const, unsignedTx: built.unsignedTx, feePayer: built.feePayer, transferId };
    });

    if (outcome.kind === 'limit') {
      metrics.inc('limit_blocks');
      const l = outcome.limit;
      return reply.code(403).send({
        error: 'limit_exceeded',
        kind: l.kind,
        currentTier: l.currentTier,
        requiredTier: l.requiredTier,
        limitUsd: l.limitUsd,
        reason: l.reason,
      });
    }
    if (outcome.kind === 'blocked') return reply.code(403).send({ error: 'blocked', reason: outcome.reason });
    if (outcome.kind === 'solana_unavailable') return reply.code(503).send({ error: 'solana_unavailable' });
    return { unsignedTx: outcome.unsignedTx, feePayer: outcome.feePayer, transferId: outcome.transferId } satisfies PrepareTransferResponse;
  });

  app.post<{ Body: SubmitTransferRequest }>('/transfer/submit', async (req, reply) => {
    const userId = requireUserId(req);
    const { transferId, signature } = req.body ?? ({} as SubmitTransferRequest);
    if (!transferId || !signature) return reply.code(400).send({ error: 'missing_fields' });

    // The client already signed + broadcast (Privy / dev keypair); just record the signature.
    // Scoped to the owner so a user can only attach to their own transfer.
    let matched: boolean;
    try {
      matched = await attachTransferSignature(transferId, signature, userId);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'signature_exists' });
      throw e;
    }
    if (!matched) return reply.code(404).send({ error: 'transfer_not_found' });
    // Status stays 'pending'; the M2 confirmer flips it to confirmed/failed.
    return { signature, status: 'pending' } satisfies SubmitTransferResponse;
  });

  // --- devnet faucet: mint controlled test USDC to the caller's wallet (dev/devnet only) ---
  app.post<{ Body: FaucetRequest }>('/devnet/faucet', async (req, reply) => {
    if (!config.isDevelopment) {
      return reply.code(403).send({ error: 'faucet_disabled' });
    }
    const userId = requireUserId(req);
    const requested = req.body?.amountUsd;
    const amountUsd = requested && requested > 0 ? Math.min(requested, 1000) : 100;

    const wallet = await getWalletForUser(userId);
    if (!wallet?.address) return reply.code(404).send({ error: 'wallet_not_found' });

    let signature: string;
    try {
      signature = await mintUsdcTo(wallet.address, amountUsd);
    } catch (e) {
      req.log.error({ err: e }, 'faucet mint failed');
      return reply.code(503).send({ error: 'solana_unavailable' });
    }
    await recordDeposit({ toUserId: userId, toAddress: wallet.address, amountUsd, signature });
    const balanceUsd = await getUsdcBalance(wallet.address);
    return { signature, balanceUsd } satisfies FaucetResponse;
  });

  // --- M2: Helius webhook for push confirmation (poller in confirmer.ts is the fallback) ---
  app.post<{ Querystring: { secret?: string } }>('/webhooks/helius', async (req, reply) => {
    if (config.heliusWebhookSecret) {
      if (req.query.secret !== config.heliusWebhookSecret) return reply.code(401).send({ error: 'unauthorized' });
    } else {
      req.log.warn('HELIUS_WEBHOOK_SECRET unset — /webhooks/helius is open (dev only)');
    }
    const events = Array.isArray(req.body)
      ? (req.body as Array<{ signature?: string; transactionError?: unknown }>)
      : [];
    for (const ev of events) {
      if (typeof ev?.signature === 'string') {
        // Helius sets transactionError (non-null) on failed txs; null/absent means success.
        const status = ev.transactionError == null ? 'confirmed' : 'failed';
        const id = await setTransferStatusBySignature(ev.signature, status);
        // M6: on a real pending→confirmed transition, drive the same advance-order + notify path the
        // poller uses (previously the webhook only flipped the row, so prod webhook-wins dropped both).
        if (id && status === 'confirmed') await onTransferConfirmedAndNotify(id);
      }
    }
    return { ok: true };
  });

  // --- M1: stablecoin on/off-ramp order lifecycle (quote engine + order state machine) ---

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

  app.get('/orders', async (req): Promise<OrdersResponse> => {
    const userId = requireUserId(req);
    return { orders: await listOrdersForUser(userId) };
  });

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

  // --- M5: KYC verification (simulated upgrade) ---
  // Real flow: a KYC vendor verifies documents and calls back. Here, "verify" promotes the tier
  // (unlocks merchant pay at tier 2). The web "Verify identity" button calls this.
  app.post('/kyc/verify', async (req, reply) => {
    const userId = requireUserId(req);
    const next = Math.max(await getUserKycTier(userId), 2);
    await setUserKycTier(userId, next);
    await notifyKycUpgraded(userId, next); // M6
    return reply.send({ ok: true, kycTier: next });
  });

  // dev-only: set any tier directly (for exercising limits/screening).
  app.post<{ Params: { tier: string } }>('/sim/kyc/:tier', async (req, reply) => {
    if (!config.isDevelopment) return reply.code(403).send({ error: 'sim_disabled' });
    const userId = requireUserId(req);
    const tier = Number(req.params.tier);
    if (!Number.isInteger(tier) || tier < 0 || tier > 3) return reply.code(400).send({ error: 'invalid_tier' });
    await setUserKycTier(userId, tier);
    return { ok: true, kycTier: tier };
  });

  // ---- M6: notifications inbox ----
  app.get('/notifications', async (req) => {
    const userId = requireUserId(req);
    const [notifications, unread] = await Promise.all([listNotifications(userId), unreadNotificationCount(userId)]);
    return { notifications, unread } satisfies NotificationsResponse;
  });

  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (req, reply) => {
    const userId = requireUserId(req);
    const ok = await markNotificationRead(req.params.id, userId);
    if (!ok) return reply.code(404).send({ error: 'notification_not_found' });
    return { ok: true };
  });

  app.post('/notifications/read-all', async (req) => {
    const userId = requireUserId(req);
    await markAllNotificationsRead(userId);
    return { ok: true };
  });
}
