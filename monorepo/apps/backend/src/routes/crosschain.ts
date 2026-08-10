// crosschain.ts — v2 cross-chain USDC (docs/19). Outbound: quote → prepare (full compliance
// block, user-signed burn) → submit; the bridge poller drives attestation + settle. Inbound:
// deposit-info / deposit-balances / deposit-report (the client burns via a sponsored userOp from
// the user's own smart wallet; the attested message — not the client — is the trust boundary).
import type { FastifyInstance } from 'fastify';

import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import type {
  CrosschainQuoteResponse,
  DepositBalancesResponse,
  DepositInfoResponse,
  DepositPrepareRequest,
  DepositPrepareResponse,
  PrepareCrosschainRequest,
  PrepareCrosschainResponse,
  ReportDepositRequest,
  ReportDepositResponse,
  SubmitCrosschainRequest,
  SubmitTransferResponse,
} from '@fpay/shared';

import { requireUserId } from '../auth';
import { config } from '../envConfig';
import {
  attachTransferSignature,
  casBridgeState,
  countRecentExternalRecipients,
  createPendingTransfer,
  failUnsignedTransfer,
  findTransferByIdempotencyKey,
  getBridgeByTransferId,
  getUserKycTier,
  getWalletForUser,
  insertBridgeTransfer,
  withUserLock,
} from '../db/queries';
import { amt, positiveAmount, roundDown, roundUp, usdStr, USDC_DECIMALS } from '../lib/amount';
import { toBaseUnits } from '../lib/units';
import { CCTP_DOMAIN, EVM_CHAINS, isEvmNetwork, type EvmNetworkId } from '../services/bridge/cctp/constants';
import { buildDepositCalls, evmMinterConfigured, getUsdcBalanceOnEvm, minterAddress } from '../services/bridge/cctp/evm';
import { railFor } from '../services/bridge/registry';
import { checkSendLimit, scoreAndRecord, screenAddress } from '../services/compliance';
import { KYC_APPROVED_TIER } from '../services/kyc';
import { metrics } from '../services/metrics';
import { usdcMint } from '../services/solana';

const MIN_EXTERNAL_SEND_USD = 1;
const MAX_EXTERNAL_RECIPIENTS_PER_DAY = 10;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const EVM_TX_RE = /^0x[0-9a-fA-F]{64}$/;

export async function registerCrosschainRoutes(app: FastifyInstance) {
  // Stateless fee/ETA preview. `source` defaults to solana (outbound); inbound passes the EVM side.
  app.get<{ Querystring: { network?: string; source?: string; amountUsd?: string } }>(
    '/crosschain/quote',
    async (req, reply) => {
      requireUserId(req);
      // `network` is always the EVM side; `source` defaults to solana (outbound quote).
      const source = req.query.source ?? 'solana';
      const evmSide = source === 'solana' ? (req.query.network ?? '') : source;
      const dest = source === 'solana' ? evmSide : 'solana';
      const amountUsd = positiveAmount(req.query.amountUsd);
      if (!isEvmNetwork(evmSide) || amountUsd === null) return reply.code(400).send({ error: 'invalid_request' });
      if (!evmMinterConfigured()) return reply.code(503).send({ error: 'crosschain_unavailable' });
      const rail = railFor(source, dest);
      const q = await rail.quote(source, dest, amountUsd);
      return {
        source,
        destination: dest,
        amountUsd,
        feeUsd: q.feeUsd,
        railFeeUsd: q.railFeeUsd,
        totalFeeUsd: Math.round((q.feeUsd + q.railFeeUsd) * 100) / 100,
        etaSecs: q.etaSecs,
      } satisfies CrosschainQuoteResponse;
    },
  );

  // Outbound prepare — the money-movement trust boundary: the FULL compliance block from
  // /transfer/prepare re-attached in the same order (docs/16 §6 controls apply to every rail).
  app.post<{ Body: PrepareCrosschainRequest }>('/crosschain/prepare', async (req, reply) => {
    const userId = requireUserId(req);
    const { network, toAddress, note, idempotencyKey } = req.body ?? ({} as PrepareCrosschainRequest);
    const amountUsd = positiveAmount(req.body?.amountUsd);
    if (amountUsd === null) return reply.code(400).send({ error: 'invalid_amount' });
    if (!isEvmNetwork(network ?? '')) return reply.code(400).send({ error: 'unsupported_network' });
    if (!evmMinterConfigured()) return reply.code(503).send({ error: 'crosschain_unavailable' });
    if (!EVM_ADDRESS_RE.test(toAddress ?? '')) return reply.code(400).send({ error: 'invalid_recipient' });
    const addr = toAddress.toLowerCase();
    if (addr === minterAddress()) return reply.code(400).send({ error: 'invalid_recipient' });

    const fromWallet = await getWalletForUser(userId);
    if (!fromWallet?.address) return reply.code(404).send({ error: 'sender_wallet_not_found' });
    // Sending to your own deposit address is a circle — refuse like self-send.
    const ownEvm = await getWalletForUser(userId, 'ethereum');
    if (ownEvm?.address && addr === ownEvm.address.toLowerCase()) {
      return reply.code(400).send({ error: 'self_send_not_allowed' });
    }

    // Withdrawal to an unhosted wallet — verified tier required (same shape as money.ts).
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

    const rail = railFor('solana', network);
    const quote = await rail.quote('solana', network, amountUsd);
    const totalDebitUsd = amountUsd + quote.feeUsd;

    // Idempotency: signed/non-pending → 409; unsigned pending → rebuild the burn from the ROW
    // (a replay can never mutate intent) and return the same transferId.
    if (idempotencyKey) {
      const existing = await findTransferByIdempotencyKey(userId, idempotencyKey);
      if (existing) {
        if (existing.signature || existing.status !== 'pending') {
          return reply.code(409).send({ error: 'duplicate_request', transferId: existing.id });
        }
        const bridge = await getBridgeByTransferId(existing.id);
        if (!bridge) return reply.code(409).send({ error: 'duplicate_request', transferId: existing.id });
        try {
          const leg = await rail.buildSourceLeg({
            fromOwner: existing.fromAddress,
            source: 'solana',
            dest: bridge.destination_chain,
            recipient: bridge.recipient,
            amountUsd: Number(bridge.amount_usdc),
            feeUsd: Number(bridge.fee_usdc),
          });
          await casBridgeState(bridge.id, ['created'], 'created', { railData: leg.railData });
          return {
            unsignedTx: leg.unsignedTx,
            feePayer: leg.feePayer,
            transferId: existing.id,
            feeUsd: Number(bridge.fee_usdc),
            railFeeUsd: Number(bridge.rail_fee_usdc),
            totalFeeUsd: Math.round((Number(bridge.fee_usdc) + Number(bridge.rail_fee_usdc)) * 100) / 100,
            etaSecs: quote.etaSecs,
          } satisfies PrepareCrosschainResponse;
        } catch (e) {
          req.log.error({ err: e }, 'crosschain replay build failed');
          return reply.code(503).send({ error: 'crosschain_unavailable' });
        }
      }
    }

    // Serialized under the per-user lock: cap check + insert can't be raced (TOCTOU-closed).
    const outcome = await withUserLock(userId, async () => {
      const limit = await checkSendLimit(userId, totalDebitUsd);
      if (!limit.ok) return { kind: 'limit' as const, limit };
      const denylisted = (await screenAddress(addr)) || (await screenAddress(fromWallet.address));
      const risk = await scoreAndRecord({
        userId,
        kind: 'send',
        amountUsd: totalDebitUsd,
        denylisted,
        counterparty: addr,
        externalRecipient: true,
      });
      if (risk.decision === 'block') return { kind: 'blocked' as const, reason: risk.reason };

      let leg;
      try {
        leg = await rail.buildSourceLeg({
          fromOwner: fromWallet.address,
          source: 'solana',
          dest: network,
          recipient: addr,
          amountUsd,
          feeUsd: quote.feeUsd,
        });
      } catch (e) {
        req.log.error({ err: e }, 'crosschain burn build failed');
        return { kind: 'unavailable' as const };
      }

      let transferId: string;
      try {
        ({ id: transferId } = await createPendingTransfer({
          fromUserId: userId,
          toUserId: null,
          fromAddress: fromWallet.address,
          toAddress: addr,
          amountUsd,
          kind: 'send',
          note,
          chain: 'solana', // the burn leg — the existing confirmer follows it
          idempotencyKey,
        }));
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return { kind: 'duplicate' as const };
        throw e;
      }
      await insertBridgeTransfer({
        transferId,
        userId,
        rail: rail.id,
        direction: 'out',
        sourceChain: 'solana',
        sourceDomain: CCTP_DOMAIN.solana,
        destinationChain: network,
        destinationDomain: CCTP_DOMAIN[network],
        recipient: addr,
        amountUsd,
        feeUsd: quote.feeUsd,
        railFeeUsd: quote.railFeeUsd,
        railData: leg.railData,
      });
      return { kind: 'ok' as const, leg, transferId };
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
    if (outcome.kind === 'unavailable') return reply.code(503).send({ error: 'crosschain_unavailable' });
    if (outcome.kind === 'duplicate') return reply.code(409).send({ error: 'duplicate_request' });
    return {
      unsignedTx: outcome.leg.unsignedTx,
      feePayer: outcome.leg.feePayer,
      transferId: outcome.transferId,
      feeUsd: quote.feeUsd,
      railFeeUsd: quote.railFeeUsd,
      totalFeeUsd: Math.round((quote.feeUsd + quote.railFeeUsd) * 100) / 100,
      etaSecs: quote.etaSecs,
    } satisfies PrepareCrosschainResponse;
  });

  app.post<{ Body: SubmitCrosschainRequest }>('/crosschain/submit', async (req, reply) => {
    const userId = requireUserId(req);
    const { transferId, signature } = req.body ?? ({} as SubmitCrosschainRequest);
    if (!transferId || !signature) return reply.code(400).send({ error: 'missing_fields' });
    let matched: boolean;
    try {
      matched = await attachTransferSignature(transferId, signature, userId);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'signature_exists' });
      throw e;
    }
    if (!matched) return reply.code(404).send({ error: 'transfer_not_found' });
    const bridge = await getBridgeByTransferId(transferId);
    if (bridge) await casBridgeState(bridge.id, ['created'], 'source_submitted', { sourceTx: signature });
    return { signature, status: 'pending' } satisfies SubmitTransferResponse;
  });

  // ---- inbound: add money from another wallet (user's own smart-wallet deposit address) ----

  app.get('/crosschain/deposit-info', async (req, reply): Promise<DepositInfoResponse | undefined> => {
    const userId = requireUserId(req);
    if (!evmMinterConfigured()) return reply.code(503).send({ error: 'crosschain_unavailable' });
    const evm = await getWalletForUser(userId, 'ethereum');
    const options = [];
    for (const network of ['base', 'arbitrum', 'ethereum'] as EvmNetworkId[]) {
      const rail = railFor(network, 'solana');
      // Advisory per-network terms at a nominal $100 (the real quote happens at move time).
      const q = await rail.quote(network, 'solana', 100);
      options.push({ network, feeUsd: q.feeUsd, etaSecs: q.etaSecs });
    }
    return { evmAddress: evm?.address ?? undefined, options };
  });

  app.get('/crosschain/deposit-balances', async (req, reply): Promise<DepositBalancesResponse | undefined> => {
    const userId = requireUserId(req);
    if (!evmMinterConfigured()) return reply.code(503).send({ error: 'crosschain_unavailable' });
    const evm = await getWalletForUser(userId, 'ethereum');
    if (!evm?.address) return reply.code(404).send({ error: 'no_deposit_address' });
    const balances: Record<string, number> = {};
    for (const network of ['base', 'arbitrum', 'ethereum'] as EvmNetworkId[]) {
      try {
        balances[network] = await getUsdcBalanceOnEvm(network, evm.address);
      } catch {
        balances[network] = 0; // unreachable RPC → show nothing rather than fail the sheet
      }
    }
    return { balances };
  });

  // Server-built calldata for the sponsored move-to-balance userOp — the client never needs an
  // EVM ABI encoder, and the burn's mintRecipient is ALWAYS the caller's own Solana ATA.
  app.post<{ Body: DepositPrepareRequest }>('/crosschain/deposit-prepare', async (req, reply) => {
    const userId = requireUserId(req);
    const { sourceChain } = req.body ?? ({} as DepositPrepareRequest);
    if (!isEvmNetwork(sourceChain ?? '')) return reply.code(400).send({ error: 'unsupported_network' });
    const amountUsd = positiveAmount(req.body?.amountUsd);
    if (amountUsd === null) return reply.code(400).send({ error: 'invalid_amount' });
    if (!evmMinterConfigured()) return reply.code(503).send({ error: 'crosschain_unavailable' });
    const solWallet = await getWalletForUser(userId);
    if (!solWallet?.address) return reply.code(404).send({ error: 'no_deposit_address' });

    const rail = railFor(sourceChain, 'solana');
    const q = await rail.quote(sourceChain, 'solana', amountUsd);
    const burnAmountUsd = Math.floor((amountUsd - q.feeUsd) * 100) / 100;
    if (burnAmountUsd < MIN_EXTERNAL_SEND_USD) {
      return reply.code(400).send({ error: 'amount_too_small', minUsd: MIN_EXTERNAL_SEND_USD + q.feeUsd });
    }
    const ata = await getAssociatedTokenAddress(usdcMint(), new PublicKey(solWallet.address));
    const toBase = (usd: number) => BigInt(Math.round(usd * 1e6));
    const calls = buildDepositCalls(sourceChain as EvmNetworkId, {
      burnAmountBase: toBase(burnAmountUsd),
      feeBase: toBase(q.feeUsd),
      feeTreasury: minterAddress(),
      mintRecipientBytes32: `0x${Buffer.from(ata.toBytes()).toString('hex')}`,
      maxFeeBase: toBase(Math.max(q.railFeeUsd * 1.5, 0.01)),
      minFinalityThreshold: rail.id === 'cctp_fast' ? 1000 : 2000,
    });
    return {
      chainId: EVM_CHAINS[sourceChain].chainId,
      calls,
      burnAmountUsd,
      feeUsd: q.feeUsd,
      railFeeUsd: q.railFeeUsd,
      totalFeeUsd: Math.round((q.feeUsd + q.railFeeUsd) * 100) / 100,
      etaSecs: q.etaSecs,
    } satisfies DepositPrepareResponse;
  });

  // The client reports its sponsored burn. Amount is PROVISIONAL — the poller reconciles amount
  // AND verifies the attested mintRecipient is the caller's own ATA before any mint happens.
  app.post<{ Body: ReportDepositRequest }>('/crosschain/deposit', async (req, reply) => {
    const userId = requireUserId(req);
    const { sourceChain, txHash } = req.body ?? ({} as ReportDepositRequest);
    if (!isEvmNetwork(sourceChain ?? '')) return reply.code(400).send({ error: 'unsupported_network' });
    if (!EVM_TX_RE.test(txHash ?? '')) return reply.code(400).send({ error: 'invalid_request' });
    const amountUsd = positiveAmount(req.body?.amountUsd);
    if (amountUsd === null) return reply.code(400).send({ error: 'invalid_amount' });
    if (!evmMinterConfigured()) return reply.code(503).send({ error: 'crosschain_unavailable' });

    const solWallet = await getWalletForUser(userId);
    const evmWallet = await getWalletForUser(userId, 'ethereum');
    if (!solWallet?.address || !evmWallet?.address) return reply.code(404).send({ error: 'no_deposit_address' });

    // Screening on the user's own deposit address + a risk-trail entry (money-in, no tier gate —
    // matches faucet/receive; flagged in docs/19 for compliance sign-off).
    if (await screenAddress(evmWallet.address.toLowerCase())) {
      return reply.code(403).send({ error: 'blocked', reason: 'account flagged' });
    }
    await scoreAndRecord({ userId, kind: 'deposit', amountUsd, denylisted: false, counterparty: txHash });

    const rail = railFor(sourceChain, 'solana');
    const { id: transferId } = await createPendingTransfer({
      fromUserId: null,
      toUserId: userId,
      fromAddress: evmWallet.address.toLowerCase(),
      toAddress: solWallet.address,
      amountUsd,
      kind: 'add',
      chain: 'solana', // the future mint leg — confirmer follows it once the fee-payer signs
    });
    try {
      await insertBridgeTransfer({
        transferId,
        userId,
        rail: rail.id,
        direction: 'in',
        sourceChain,
        sourceDomain: CCTP_DOMAIN[sourceChain],
        destinationChain: 'solana',
        destinationDomain: CCTP_DOMAIN.solana,
        recipient: solWallet.address, // owner; the rail verifies the attested ATA matches
        amountUsd,
        feeUsd: config.cctpInFeeUsd[sourceChain] ?? 0,
        sourceTx: txHash.toLowerCase(),
        state: 'source_submitted',
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        await failUnsignedTransfer(transferId); // don't leave the just-created companion dangling
        return reply.code(409).send({ error: 'duplicate_request' });
      }
      throw e;
    }
    const q = await rail.quote(sourceChain, 'solana', amountUsd);
    return { transferId, etaSecs: q.etaSecs } satisfies ReportDepositResponse;
  });
}
