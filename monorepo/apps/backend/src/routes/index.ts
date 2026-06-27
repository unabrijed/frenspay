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
  OrderResponse,
  OrdersResponse,
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

import { authPreHandler, requirePrivyDid, requireUserId } from '../auth';
import { config } from '../config';
import {
  appendOrderEvent,
  attachTransferSignature,
  cancelOrder,
  cancelRequest,
  createPendingTransfer,
  createRequest,
  findUserByHandle,
  findUserById,
  getOrderForUser,
  getOrderSimRow,
  getWalletForUser,
  listOrdersForUser,
  listRequestsForUser,
  listTransactionsForUser,
  markRequestPaid,
  recordDeposit,
  resolveHandleToFriend,
  setTransferStatusBySignature,
  updateOrder,
  upsertUserByPrivyDid,
} from '../db/queries';
import {
  confirmOrderFromQuote,
  flagResolution,
  markFundSubmitted,
  refundToUser,
  releaseToMerchant,
} from '../services/orderMachine';
import { createQuote } from '../services/quoteEngine';
import { buildUsdcTransfer, getUsdcBalance, mintUsdcTo } from '../services/solana';

export async function registerRoutes(app: FastifyInstance) {
  // Identity: Privy bearer token in prod; x-dev-user-id shim when Privy is unconfigured.
  app.addHook('preHandler', authPreHandler);

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

    let built;
    try {
      built = await buildUsdcTransfer({
        fromOwner: fromWallet.address,
        toOwner: toWallet.address,
        amountUsd,
      });
    } catch (e) {
      // RPC down / misconfigured mint / blockhash fetch failed — surface as a clean 503.
      req.log.error({ err: e }, 'buildUsdcTransfer failed');
      return reply.code(503).send({ error: 'solana_unavailable' });
    }
    const { unsignedTx, feePayer } = built;
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
    return { unsignedTx, feePayer, transferId } satisfies PrepareTransferResponse;
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
        await setTransferStatusBySignature(ev.signature, status);
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
    const result = await confirmOrderFromQuote(userId, quoteId);
    if ('error' in result) {
      const code =
        result.error === 'quote_expired' ? 409 : result.error === 'solana_unavailable' ? 503 : 404;
      return reply.code(code).send({ error: result.error });
    }
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
}
