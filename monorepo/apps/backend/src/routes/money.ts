// money.ts — P2P money movement: balance/activity, payment requests, gas-sponsored USDC
// transfers (prepare/submit), devnet faucet. Compliance controls are INLINE in the prepare
// handler — any new money-moving route must re-attach them explicitly.
import type { FastifyInstance } from 'fastify';

import type {
  BalanceResponse,
  CreateRequestRequest,
  FaucetRequest,
  FaucetResponse,
  PrepareTransferRequest,
  PrepareTransferResponse,
  RequestsResponse,
  SubmitTransferRequest,
  SubmitTransferResponse,
  TransactionsResponse,
} from '@fpay/shared';

import { requireUserId } from '../auth';
import { config } from '../config';
import {
  attachTransferSignature,
  cancelRequest,
  countRecentExternalRecipients,
  createPendingTransfer,
  createRequest,
  findTransferByIdempotencyKey,
  findUserByHandle,
  findUserById,
  getRequestNotifyInfo,
  getUserKycTier,
  getWalletForUser,
  isMerchantTreasuryAddress,
  listRequestsForUser,
  listTransactionsForUser,
  markRequestPaid,
  recordDeposit,
  withUserLock,
} from '../db/queries';
import { checkSendLimit, scoreAndRecord, screenAddress, screenHandle } from '../services/compliance';
import { KYC_APPROVED_TIER } from '../services/kyc';
import { metrics } from '../services/metrics';
import { notifyRequestPaid } from '../services/notify';
import {
  buildUsdcTransfer,
  feePayerAddress,
  getUsdcBalance,
  isValidRecipientOwner,
  mintUsdcTo,
} from '../services/solana';

// External (raw-address) send guards — both bound the fee-payer ATA-rent drain (~0.002 SOL per
// fresh recipient token account) and keep dust-spam off the rail. See docs/16 §6.
const MIN_EXTERNAL_SEND_USD = 1;
const MAX_EXTERNAL_RECIPIENTS_PER_DAY = 10;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Well-known program addresses that pass the on-curve check (32 zero bytes IS a valid curve
// encoding) but can never sign — USDC sent to them is burned. Users copy these off explorers.
const KNOWN_UNSPENDABLE = new Set([
  '11111111111111111111111111111111', // system program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL token program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // associated token account program
]);

export async function registerMoneyRoutes(app: FastifyInstance) {
  // --- balance / activity ---
  app.get('/balance', async (req): Promise<BalanceResponse> => {
    const userId = requireUserId(req);
    const wallet = await getWalletForUser(userId);
    if (!wallet?.address) return { balanceUsd: 0 };
    return { balanceUsd: await getUsdcBalance(wallet.address) };
  });

  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/transactions',
    async (req): Promise<TransactionsResponse> => {
      const userId = requireUserId(req);
      const page = await listTransactionsForUser(userId, Number(req.query.limit ?? 50), req.query.cursor);
      return { transactions: page.items, nextCursor: page.nextCursor };
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
  // Two recipient modes: @handle (in-app user) or raw toAddress (external Solana wallet, tier-2
  // gated). Exactly one must be set. All compliance controls run for BOTH modes (docs/16 §6).
  app.post<{ Body: PrepareTransferRequest }>('/transfer/prepare', async (req, reply) => {
    const userId = requireUserId(req);
    const { toHandle, toAddress, amountUsd, note, idempotencyKey } = req.body ?? ({} as PrepareTransferRequest);
    if (!amountUsd || amountUsd <= 0) return reply.code(400).send({ error: 'invalid_amount' });
    if ((toHandle && toAddress) || (!toHandle && !toAddress)) {
      return reply.code(400).send({ error: 'invalid_recipient' });
    }

    const fromWallet = await getWalletForUser(userId);
    if (!fromWallet?.address) return reply.code(404).send({ error: 'sender_wallet_not_found' });

    let toUserId: string | null = null;
    let toOwnerAddress: string;
    const external = !toHandle;
    if (toHandle) {
      const to = await findUserByHandle(toHandle);
      const toWallet = to ? await getWalletForUser(to.id) : null;
      if (!to || !toWallet?.address) return reply.code(404).send({ error: 'recipient_not_found' });
      if (to.id === userId) return reply.code(400).send({ error: 'self_send_not_allowed' });
      toUserId = to.id;
      toOwnerAddress = toWallet.address;
    } else {
      const addr = (toAddress as string).trim();
      // v1 executes on Solana only. An EVM-shaped address is a real wallet on a rail we don't run
      // yet — distinct error so the client shows the "coming soon" networks, not a generic failure.
      if (EVM_ADDRESS_RE.test(addr)) return reply.code(400).send({ error: 'unsupported_network' });
      // Decode + 32 bytes + ed25519 on-curve: token accounts copied off explorers, PDAs, and
      // program ids all fail HERE as a clean 400 instead of inside the builder as a 503.
      if (!isValidRecipientOwner(addr)) return reply.code(400).send({ error: 'invalid_recipient' });
      if (addr === fromWallet.address) return reply.code(400).send({ error: 'self_send_not_allowed' });
      // The app's operational wallets are valid on-curve recipients; deposits there are lost funds.
      // Same for known program ids and the mint itself (all on-curve encodings, none can sign).
      if (
        addr === feePayerAddress() ||
        addr === config.usdcMint ||
        KNOWN_UNSPENDABLE.has(addr) ||
        (await isMerchantTreasuryAddress(addr))
      ) {
        return reply.code(400).send({ error: 'invalid_recipient' });
      }
      // Withdrawal to an unhosted wallet — verified tier required. LimitExceededError shape so the
      // client's existing "verify to continue" plumbing handles it.
      const tier = await getUserKycTier(userId);
      if (tier < KYC_APPROVED_TIER) {
        return reply.code(403).send({
          error: 'limit_exceeded',
          kind: 'send',
          currentTier: tier,
          requiredTier: KYC_APPROVED_TIER,
          limitUsd: 0,
          reason: 'verify your identity to send to outside wallets',
        });
      }
      if (amountUsd < MIN_EXTERNAL_SEND_USD) {
        return reply.code(400).send({ error: 'amount_too_small', minUsd: MIN_EXTERNAL_SEND_USD });
      }
      if ((await countRecentExternalRecipients(userId, 24)) >= MAX_EXTERNAL_RECIPIENTS_PER_DAY) {
        return reply.code(429).send({ error: 'too_many_new_recipients' });
      }
      toOwnerAddress = addr;
    }

    // Prepare dedupe. A key with a SIGNED transfer already behind it means a spendable tx exists —
    // refuse to mint another (409). An unsigned-pending row is an abandoned prepare (e.g. its
    // blockhash expired before signing): replay idempotently — rebuild a fresh tx from the ROW's
    // recipient/amount (not the request, so a replay can't mutate the intent) for the same row.
    if (idempotencyKey) {
      const existing = await findTransferByIdempotencyKey(userId, idempotencyKey);
      if (existing) {
        if (existing.signature || existing.status !== 'pending') {
          return reply.code(409).send({ error: 'duplicate_request', transferId: existing.id });
        }
        try {
          const rebuilt = await buildUsdcTransfer({
            fromOwner: existing.fromAddress,
            toOwner: existing.toAddress,
            amountUsd: existing.amountUsd,
          });
          return {
            unsignedTx: rebuilt.unsignedTx,
            feePayer: rebuilt.feePayer,
            transferId: existing.id,
          } satisfies PrepareTransferResponse;
        } catch (e) {
          req.log.error({ err: e }, 'buildUsdcTransfer failed (idempotent replay)');
          return reply.code(503).send({ error: 'solana_unavailable' });
        }
      }
    }

    // M5 limits + screening, M6 serialized under a per-user advisory lock so the rolling daily-cap
    // check + the transfer insert can't be raced by two concurrent requests (closes the audit TOCTOU).
    const outcome = await withUserLock(userId, async () => {
      const limit = await checkSendLimit(userId, amountUsd);
      if (!limit.ok) return { kind: 'limit' as const, limit };
      // sanctions screening + fraud score (simulated) on BOTH parties (sender + recipient).
      const denylisted =
        (toHandle ? await screenHandle(toHandle) : false) ||
        (await screenAddress(toOwnerAddress)) ||
        (await screenAddress(fromWallet.address));
      const risk = await scoreAndRecord({
        userId,
        kind: 'send',
        amountUsd,
        denylisted,
        counterparty: toHandle ?? toOwnerAddress,
        externalRecipient: external,
      });
      if (risk.decision === 'block') return { kind: 'blocked' as const, reason: risk.reason };

      let built;
      try {
        built = await buildUsdcTransfer({ fromOwner: fromWallet.address, toOwner: toOwnerAddress, amountUsd });
      } catch (e) {
        // Recipient is pre-validated above, so failures here are genuinely RPC/mint/blockhash —
        // surface as a clean 503.
        req.log.error({ err: e }, 'buildUsdcTransfer failed');
        return { kind: 'solana_unavailable' as const };
      }
      // Record the intent now so /transfer/submit only needs the transferId + signed tx.
      let transferId: string;
      try {
        ({ id: transferId } = await createPendingTransfer({
          fromUserId: userId,
          toUserId,
          fromAddress: fromWallet.address,
          toAddress: toOwnerAddress,
          amountUsd,
          kind: 'send',
          note,
          chain: 'solana',
          idempotencyKey,
        }));
      } catch (e) {
        // Unique-index race on the idempotency key: a concurrent prepare with the same key won.
        if ((e as { code?: string }).code === '23505') return { kind: 'duplicate' as const };
        throw e;
      }
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
    if (outcome.kind === 'duplicate') return reply.code(409).send({ error: 'duplicate_request' });
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
}
