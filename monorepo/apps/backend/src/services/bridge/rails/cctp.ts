// rails/cctp.ts — the two CCTP V2 rails from one factory: cctp_standard (free, source-chain
// finality) and cctp_fast (seconds, Circle bps fee). They differ only in finality threshold,
// maxFee, fee math, ETA, and polling cadence — the generic bridge machine drives both.
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

import { config } from '../../../envConfig';
import { attachPlatformTransferSignature, failUnsignedTransfer, type BridgeTransferRow } from '../../../db/queries';
import { metrics } from '../../metrics';
import { usdcMint } from '../../solana';
import { EVM_CHAINS, isEvmNetwork } from '../cctp/constants';
import { getEvmReceiptStatus, receiveMessageOnEvm } from '../cctp/evm';
import { fetchAttestation, fetchFastFeeBps } from '../cctp/iris';
import { buildDepositForBurnTx, evmAddressToBytes32Pk, receiveMessageOnSolana } from '../cctp/solana';
import { nextAttempt, settle, transition } from '../machine';
import type { MachineCtx, Rail, RailQuote, SourceLeg } from '../rail';

const round2 = (n: number) => Math.round(n * 100) / 100;

function makeCctpRail(opts: { id: string; fast: boolean }): Rail {
  const { id, fast } = opts;
  // Poll cadence: fast attestations land in seconds; standard EVM-source waits L1 finality.
  const backoffBase = 5_000;
  const backoffCap = fast ? 15_000 : 30_000;
  // retry_count threshold before flagging 'delayed' (base 5s, capped — ≈10 min of polling).
  const delayedAfterRetries = fast ? 25 : 40;

  const railFee = async (source: string, dest: string, amountUsd: number): Promise<number> => {
    if (!fast) return 0;
    const bps = await fetchFastFeeBps(cctpDomain(source), cctpDomain(dest));
    return round2((amountUsd * bps) / 10_000);
  };

  return {
    id,

    serves(source, dest) {
      return (
        (source === 'solana' && isEvmNetwork(dest)) || (isEvmNetwork(source) && dest === 'solana')
      );
    },

    async quote(source, dest, amountUsd): Promise<RailQuote> {
      const outbound = source === 'solana';
      const feeUsd = outbound ? (config.cctpFeeUsd[dest] ?? 0) : (config.cctpInFeeUsd[source] ?? 0);
      const railFeeUsd = await railFee(source, dest, amountUsd);
      const etaSecs = fast ? 45 : outbound ? EVM_CHAINS[dest].etaSecs : 1140; // EVM-source standard ≈19min
      return { feeUsd, railFeeUsd, etaSecs };
    },

    async buildSourceLeg(input): Promise<SourceLeg> {
      if (input.source !== 'solana') {
        // Inbound EVM burns are built client-side as paymaster-sponsored userOps; the backend
        // learns of them via POST /crosschain/deposit.
        throw new Error(`${id}: only solana-source legs are server-built`);
      }
      const maxFeeUsd = fast ? round2((await railFee(input.source, input.dest, input.amountUsd)) * 1.5) : 0;
      const built = await buildDepositForBurnTx({
        fromOwner: input.fromOwner,
        destinationDomain: cctpDomain(input.dest),
        mintRecipient0x: input.recipient,
        amountUsd: input.amountUsd,
        feeUsd: input.feeUsd,
        minFinalityThreshold: fast ? 1000 : 2000,
        maxFeeUsd,
      });
      return {
        unsignedTx: built.unsignedTx,
        feePayer: built.feePayer,
        railData: { eventAccount: built.eventAccount },
      };
    },

    async advance(row: BridgeTransferRow, ctx: MachineCtx): Promise<void> {
      if (row.state === 'source_submitted' && row.direction === 'in') return advanceInboundBurnReceipt(row, ctx);
      if (row.state === 'source_confirmed') return advanceAttestation(row, ctx);
      if (row.state === 'ready') return advanceSettle(row, ctx);
      if (row.state === 'settling' && row.direction === 'out') return advanceReceipt(row, ctx);
      // Anything else: park briefly (machine handles outbound source_submitted + inbound settling).
      await transition(row, [row.state], row.state, 'noop', { nextAttemptAt: nextAttempt(0, 10_000, 10_000) });
    },
  };

  async function advanceInboundBurnReceipt(row: BridgeTransferRow, ctx: MachineCtx): Promise<void> {
    if (!row.source_tx) return;
    const status = await getEvmReceiptStatus(asEvm(row.source_chain), row.source_tx);
    if (status === 'success') {
      await transition(row, ['source_submitted'], 'source_confirmed', 'burn_receipt', {
        retryCount: 0,
        nextAttemptAt: null,
      });
    } else if (status === 'reverted') {
      // Nothing was burned — USDC never left the user's wallet. Fail both sides cleanly.
      ctx.log(`bridge ${row.id}: inbound burn reverted on ${row.source_chain}`);
      await transition(row, ['source_submitted'], 'failed', 'burn_reverted');
      await failUnsignedTransfer(row.transfer_id);
    } else {
      const retry = row.retry_count + 1;
      // A wrong/foreign hash never mines: flag for ops after ~1h of polling.
      const stuck = retry >= 120 && row.resolution !== 'needs_action';
      await transition(row, ['source_submitted'], 'source_submitted', 'burn_receipt_pending', {
        retryCount: retry,
        nextAttemptAt: nextAttempt(retry, backoffBase, 30_000),
        ...(stuck ? { resolution: 'needs_action' as const } : {}),
      });
    }
  }

  async function advanceAttestation(row: BridgeTransferRow, ctx: MachineCtx): Promise<void> {
    if (!row.source_tx) return;
    const att = await fetchAttestation(row.source_domain, row.source_tx);
    if (!att || att.status !== 'complete') {
      const retry = row.retry_count + 1;
      const flagDelayed = retry >= delayedAfterRetries && row.resolution !== 'delayed';
      if (flagDelayed) metrics.inc('bridge_attestation_delayed');
      await transition(row, ['source_confirmed'], 'source_confirmed', 'attestation_pending', {
        retryCount: retry,
        nextAttemptAt: nextAttempt(retry, backoffBase, backoffCap),
        ...(flagDelayed ? { resolution: 'delayed' as const } : {}),
      });
      return;
    }

    // Inbound trust boundary: the ATTESTED message is authoritative, not the client's report.
    if (row.direction === 'in' && att.decoded?.mintRecipient) {
      const expectedAta = await getAssociatedTokenAddress(usdcMint(), new PublicKey(row.recipient));
      const actual = decodedRecipientToBase58(att.decoded.mintRecipient);
      if (actual && actual !== expectedAta.toBase58()) {
        ctx.log(`bridge ${row.id}: mintRecipient mismatch (${actual} != ${expectedAta.toBase58()})`);
        await transition(row, ['source_confirmed'], 'source_confirmed', 'recipient_mismatch', {
          resolution: 'needs_action',
          nextAttemptAt: nextAttempt(0, 3_600_000, 3_600_000),
        });
        return;
      }
    }

    await transition(row, ['source_confirmed'], 'ready', 'attested', {
      nextAttemptAt: null,
      retryCount: 0,
      railData: { message: att.message, attestation: att.attestation, eventNonce: att.eventNonce },
    });
  }

  async function advanceSettle(row: BridgeTransferRow, ctx: MachineCtx): Promise<void> {
    const message = row.rail_data.message as string | undefined;
    const attestation = row.rail_data.attestation as string | undefined;
    if (!message || !attestation) return;

    // Claim FIRST: a duplicate settle broadcast costs gas (loser reverts on used-nonce).
    const claimed = await transition(row, ['ready'], 'settling', 'settle_claimed');
    if (!claimed) return;

    try {
      if (row.direction === 'out') {
        const hash = await receiveMessageOnEvm(asEvm(row.destination_chain), message, attestation);
        await transition(row, ['settling'], 'settling', 'mint_broadcast', {
          settleTx: hash,
          nextAttemptAt: nextAttempt(0, backoffBase, backoffBase),
        });
      } else {
        const sig = await receiveMessageOnSolana({
          messageHex: message,
          attestationHex: attestation,
          recipientOwner: row.recipient,
          remoteUsdcAddress0x: EVM_CHAINS[asEvm(row.source_chain)].usdc,
          remoteDomain: row.source_domain,
        });
        await attachPlatformTransferSignature(row.transfer_id, sig);
        await transition(row, ['settling'], 'settling', 'mint_broadcast', {
          settleTx: sig,
          nextAttemptAt: nextAttempt(0, backoffBase, backoffBase),
        });
      }
    } catch (e) {
      const msg = String(e);
      // Someone (permissionlessly) already replayed our attestation — the mint EXISTS. Success.
      if (/nonce.*(already|used)/i.test(msg)) {
        await settle(row, 'nonce_already_used');
        return;
      }
      const broke = /insufficient funds|exceeds.*balance/i.test(msg);
      if (broke) metrics.inc('bridge_settler_broke');
      metrics.inc('bridge_settle_retries');
      ctx.log(`bridge ${row.id}: settle broadcast failed — ${msg}`);
      await transition(row, ['settling'], 'ready', 'settle_failed', {
        retryCount: row.retry_count + 1,
        nextAttemptAt: nextAttempt(row.retry_count + 1, backoffBase, 120_000),
        ...(broke ? { resolution: 'needs_action' as const } : {}),
      });
    }
  }

  async function advanceReceipt(row: BridgeTransferRow, ctx: MachineCtx): Promise<void> {
    if (!row.settle_tx) {
      // Claimed but never broadcast (crash mid-settle): fall back to ready to rebroadcast.
      await transition(row, ['settling'], 'ready', 'settle_reclaimed', {
        retryCount: row.retry_count + 1,
        nextAttemptAt: nextAttempt(row.retry_count + 1, backoffBase, 60_000),
      });
      return;
    }
    const status = await getEvmReceiptStatus(asEvm(row.destination_chain), row.settle_tx);
    if (status === 'success') {
      await settle(row, 'mint_receipt', row.settle_tx);
    } else if (status === 'reverted') {
      metrics.inc('bridge_settle_retries');
      ctx.log(`bridge ${row.id}: mint reverted on ${row.destination_chain} — retrying (attestation replayable)`);
      await transition(row, ['settling'], 'ready', 'mint_reverted', {
        retryCount: row.retry_count + 1,
        nextAttemptAt: nextAttempt(row.retry_count + 1, backoffBase, 120_000),
      });
    } else {
      await transition(row, ['settling'], 'settling', 'receipt_pending', {
        nextAttemptAt: nextAttempt(0, backoffBase, backoffBase),
      });
    }
  }
}

function cctpDomain(network: string): number {
  const d = { ethereum: 0, arbitrum: 3, solana: 5, base: 6 }[network];
  if (d === undefined) throw new Error(`no CCTP domain for ${network}`);
  return d;
}

function asEvm(network: string): 'ethereum' | 'base' | 'arbitrum' {
  if (!isEvmNetwork(network)) throw new Error(`not an EVM network: ${network}`);
  return network;
}

/** Iris returns mintRecipient as 0x-hex bytes32 — for Solana destinations that's the ATA. */
function decodedRecipientToBase58(hex: string): string | null {
  try {
    const clean = hex.replace(/^0x/, '');
    if (clean.length !== 64) return null;
    return new PublicKey(Buffer.from(clean, 'hex')).toBase58();
  } catch {
    return null;
  }
}

export const cctpStandard = makeCctpRail({ id: 'cctp_standard', fast: false });
export const cctpFast = makeCctpRail({ id: 'cctp_fast', fast: true });

// evmAddressToBytes32Pk re-export keeps the deposit-info endpoint dependency-light.
export { evmAddressToBytes32Pk };
