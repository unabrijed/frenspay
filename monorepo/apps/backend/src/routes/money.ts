// money.ts — P2P money movement: balance/activity, payment requests, gas-sponsored USDC
// transfers (prepare/submit). Compliance controls are INLINE in the prepare
// handler — any new money-moving route must re-attach them explicitly.
import type { FastifyInstance } from 'fastify';

import type {
  BalanceResponse,
  CreateRequestRequest,
  MoveTransferRequest,
  PrepareTransferRequest,
  PrepareTransferResponse,
  RequestsResponse,
  SplitRequest,
  SubmitTransferRequest,
  SubmitTransferResponse,
  TransactionsResponse,
} from '@fpay/shared';

import { requireUserId } from '../auth';
import { expenseTransaction, createExpense, editExpense, expenseForTransfer, ExpenseError, publishExpense, reserveExpenseTransfer } from '../db/expenses';
import { expenseReply } from './expenses';
import { config } from '../envConfig';
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
  setTransferStatus,
  withUserLock,
} from '../db/queries';
import { amt, positiveAmount, USDC_DECIMALS } from '../lib/amount';
import { formatAmount } from '../lib/units';
import { checkSendLimit, scoreAndRecord, screenAddress, screenHandle } from '../services/compliance';
import { KYC_APPROVED_TIER } from '../services/kyc';
import { metrics } from '../services/metrics';
import { notifyRequestPaid } from '../services/notify';
import {
  buildUsdcTransfer,
  getUsdcBalance,
  isOperationalAddress,
  isValidRecipientOwner,
  SIGNATURE_RE,
} from '../services/solana';

// External (raw-address) send guards — both bound the fee-payer ATA-rent drain (~0.002 SOL per
// fresh recipient token account) and keep dust-spam off the rail. See docs/16 §6.
const MIN_EXTERNAL_SEND_USD = 1;
const MAX_EXTERNAL_RECIPIENTS_PER_DAY = 10;
// A split names at most this many friends — a bound on a request fan-out, not a product limit.
const MAX_SHARES = 20;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function registerMoneyRoutes(app: FastifyInstance) {
  // --- balance / activity ---
  app.get('/balance', async (req, reply): Promise<BalanceResponse | undefined> => {
    const userId = requireUserId(req);
    const wallet = await getWalletForUser(userId);
    if (!wallet?.address) return { balanceUsd: formatAmount(amt(0), USDC_DECIMALS) };
    try {
      return { balanceUsd: await getUsdcBalance(wallet.address) };
    } catch (err) {
      // An RPC failure is not a zero balance. 503 (same shape as the send paths below) lets the
      // client hold the last known figure; the 500 this replaced carried an EMPTY message, because
      // spl-token's errors are constructed without one — undebuggable from the response alone.
      req.log.warn({ err }, 'balance read failed — rpc unavailable');
      reply.code(503).send({ error: 'solana_unavailable' });
      return undefined;
    }
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
    const { toHandle, note } = req.body ?? ({} as CreateRequestRequest);
    const amountUsd = positiveAmount(req.body?.amountUsd);
    if (amountUsd === null) return reply.code(400).send({ error: 'invalid_amount' });
    // A request addressed to nobody can never be paid — before 0026 an unknown handle wrote one.
    const to = toHandle ? await findUserByHandle(toHandle) : null;
    if (!to) return reply.code(404).send({ error: 'unknown_handle' });
    return createRequest({ fromUserId: userId, toUserId: to.id, amountUsd, note });
  });

  // Older clients use the same atomic bill workflow and validation as the current UI.
  const transferParams={type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}};
  app.patch<{ Params: { id: string }; Body: MoveTransferRequest }>('/transfers/:id', {schema:{params:transferParams,
    body:{type:'object',required:['groupId'],additionalProperties:false,properties:{groupId:{anyOf:[{type:'string',format:'uuid'},{type:'null'}]}}}}},
    async(req,reply)=>expenseReply(reply,()=>expenseTransaction(async(db)=>{
      const user=requireUserId(req);
      const existing=await expenseForTransfer(req.params.id,user,db);
      let expense=existing??await createExpense(user,req.params.id,req.body.groupId,db);
      if(existing) expense=await editExpense(user,expense.id,{version:expense.version,groupId:req.body.groupId},db);
      await publishExpense(user,expense.id,expense.version,db);
      return {ok:true};
    })));
  app.post<{ Params: { id: string }; Body: SplitRequest }>('/transfers/:id/split',{schema:{params:transferParams,
    body:{type:'object',required:['shares'],additionalProperties:false,properties:{note:{type:'string',minLength:1,maxLength:80},
      shares:{type:'array',maxItems:MAX_SHARES,items:{type:'object',required:['handle','amountUsd'],additionalProperties:false,
        properties:{handle:{type:'string',minLength:1,maxLength:40},amountUsd:{anyOf:[{type:'number',minimum:0},{type:'string',pattern:'^\\d{1,14}(\\.\\d{1,6})?$'}]},settled:{type:'boolean'}}}}}}}},
    async(req,reply)=>expenseReply(reply,()=>expenseTransaction(async(db)=>{
      const user=requireUserId(req),body=req.body;
      if(body.shares.some((s)=>s.settled)) throw new ExpenseError('manual_payment_unsupported');
      let expense=await expenseForTransfer(req.params.id,user,db)??await createExpense(user,req.params.id,undefined,db);
      expense=await editExpense(user,expense.id,{version:expense.version,note:body.note,
        participants:[{handle:expense.creatorHandle},...body.shares.map((s)=>({handle:s.handle,shareUsd:String(s.amountUsd)}))]},db);
      await publishExpense(user,expense.id,expense.version,db);
      return {ok:true};
    })));

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
    const { toHandle, toAddress, idempotencyKey, requestId } = req.body ?? ({} as PrepareTransferRequest);
    if(requestId && (typeof requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)))
      return reply.code(400).send({error:'invalid_request'});
    // Free text into an unbounded column, rendered on the payer's feed, in notifications and on the
    // admin ledger: typed, trimmed and capped, the rule the split note above has always had.
    const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 80) : undefined;
    const amountUsd = positiveAmount(req.body?.amountUsd);
    if (amountUsd === null) return reply.code(400).send({ error: 'invalid_amount' });
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
      // Suspended accounts can't receive; same answer as not-found so account state isn't probeable.
      // Belt-and-suspenders with resolveHandleToFriend's filter — this is the last stop before money.
      if (to.status !== 'active') return reply.code(404).send({ error: 'recipient_not_found' });
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
      // The app's operational wallets, the mint and the known program ids are valid on-curve
      // recipients; deposits there are lost funds (isOperationalAddress — the stake treasury among
      // them, on purpose: staking has its own routes that record whose deposit it is). A partner's
      // release address is refused here too: it is where escrow pays them, not a wallet they send from.
      if (isOperationalAddress(addr) || (await isMerchantTreasuryAddress(addr))) {
        return reply.code(400).send({ error: 'invalid_recipient' });
      }
      // Withdrawal to an unhosted wallet — verified tier required. LimitExceededError shape so the
      // client's existing "verify to continue" plumbing handles it.
      // ...UNLESS the vendor is off (config.personaLive false — credentials blanked in the host's
      // panel). Then tier 2 is unreachable and this gate blocks every outside-wallet send forever,
      // for nobody's benefit. Same rule as /merchants/apply; checkSendLimit below still holds the
      // tier-1 $100/tx cap, and the gate re-imposes itself when the credentials come back.
      const tier = await getUserKycTier(userId);
      if (config.personaLive && tier < KYC_APPROVED_TIER) {
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
        if ((requestId ?? null) !== (existing.requestId ?? null)) return reply.code(409).send({error:'request_mismatch'});
        // A response may have been lost AFTER the wallet broadcast. Never give it a new transaction.
        if (requestId) return reply.code(409).send({error:existing.status==='failed'?'request_payment_failed':'request_payment_pending',transferId:existing.id});
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
            sponsored: rebuilt.sponsored,
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

      let transferId: string | undefined;
      const input = {fromUserId:userId,toUserId,fromAddress:fromWallet.address,toAddress:toOwnerAddress,
        amountUsd,kind:'send' as const,note,chain:'solana',idempotencyKey};
      // Reserve before building so the immutable attempt reference is part of the signed message.
      if(requestId) {
        try { ({id:transferId}=await reserveExpenseTransfer({...input,requestId})); }
        catch(e) {
          if(e instanceof ExpenseError) return {kind:'expense_error' as const,error:e.message,status:e.status};
          throw e;
        }
      }
      let built;
      try {
        built=await buildUsdcTransfer({fromOwner:fromWallet.address,toOwner:toOwnerAddress,amountUsd,
          memo:requestId?`FPAY-BILL:${transferId}`:undefined});
      } catch(e) {
        // This transaction was never returned to a signer, so this failure is safe to retry.
        if(transferId) await setTransferStatus(transferId,'failed');
        req.log.error({err:e},'buildUsdcTransfer failed');
        return {kind:'solana_unavailable' as const};
      }
      if(!transferId) {
        try { ({id:transferId}=await createPendingTransfer(input)); }
        catch(e) {
          if((e as {code?:string}).code==='23505') return {kind:'duplicate' as const};
          throw e;
        }
      }
      return { kind: 'ok' as const, unsignedTx: built.unsignedTx, feePayer: built.feePayer, sponsored: built.sponsored, transferId };
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
    if (outcome.kind === 'expense_error') return reply.code(outcome.status).send({error:outcome.error});
    return { unsignedTx: outcome.unsignedTx, feePayer: outcome.feePayer, sponsored: outcome.sponsored, transferId: outcome.transferId } satisfies PrepareTransferResponse;
  });

  app.post<{ Body: SubmitTransferRequest }>('/transfer/submit', async (req, reply) => {
    const userId = requireUserId(req);
    const { transferId, signature } = req.body ?? ({} as SubmitTransferRequest);
    if (!transferId || !signature) return reply.code(400).send({ error: 'missing_fields' });
    // Shape first: a string that is not a signature would sit 'pending' in the confirmer forever —
    // getSignatureStatuses answers null for it every tick, and null reads as "not yet".
    if (!SIGNATURE_RE.test(signature)) return reply.code(400).send({ error: 'invalid_signature' });

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

}
