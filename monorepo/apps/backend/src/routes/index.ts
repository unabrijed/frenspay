// Phase-1 Core API (backend-architecture.md §2).
// Read endpoints, Privy auth/sync, USDC transfers, and payment requests are all wired.
import type { FastifyInstance } from 'fastify';

import type {
  AuthSyncRequest,
  BalanceResponse,
  CreateRequestRequest,
  FaucetRequest,
  FaucetResponse,
  MeResponse,
  PrepareTransferRequest,
  PrepareTransferResponse,
  RequestsResponse,
  ResolveHandleResponse,
  SubmitTransferRequest,
  SubmitTransferResponse,
  TransactionsResponse,
} from '@pay/shared';

import { authPreHandler, requirePrivyDid, requireUserId } from '../auth';
import { config } from '../config';
import {
  attachTransferSignature,
  cancelRequest,
  createPendingTransfer,
  createRequest,
  findUserByHandle,
  findUserById,
  getWalletForUser,
  listRequestsForUser,
  listTransactionsForUser,
  markRequestPaid,
  recordDeposit,
  resolveHandleToFriend,
  setTransferStatusBySignature,
  upsertUserByPrivyDid,
} from '../db/queries';
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
}
