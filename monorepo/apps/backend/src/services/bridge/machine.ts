// machine.ts — rail-agnostic bridge machinery: CAS transitions + event log + backoff, the
// companion-transfer hooks, and the per-pass advance loop that dispatches due rows to their rail.
// Every edge is claim-first (casBridgeState) so the poller, the confirmer hook, and the Helius
// webhook can race safely. Post-source-confirmed states never expire — funds can be delayed,
// never stranded (attestations are permissionless + replayable).
import {
  appendBridgeEvent,
  casBridgeState,
  getBridgeByTransferId,
  getTransferStatusById,
  listBridgeDue,
  type BridgeState,
  type BridgeTransferRow,
} from '../../db/queries';
import { metrics } from '../metrics';
import { notifyBridgeSettled } from '../notify';

import { NETWORK_NAME } from './cctp/constants';
import type { MachineCtx, Rail } from './rail';

/** CAS + event append in one call. Returns whether this caller won the claim. */
export async function transition(
  row: Pick<BridgeTransferRow, 'id'>,
  fromStates: BridgeState[],
  toState: BridgeState,
  event: string,
  patch?: Parameters<typeof casBridgeState>[3],
  detail?: Record<string, unknown>,
): Promise<boolean> {
  const claimed = await casBridgeState(row.id, fromStates, toState, patch);
  if (claimed) await appendBridgeEvent(row.id, fromStates.join('|'), toState, event, detail);
  return claimed;
}

/** Exponential backoff timestamp: base·2^retry, capped. */
export function nextAttempt(retryCount: number, baseMs: number, capMs: number): Date {
  return new Date(Date.now() + Math.min(baseMs * 2 ** retryCount, capMs));
}

/** Mark settled + notify + count — the single terminal-success path for every rail. */
export async function settle(row: BridgeTransferRow, event: string, settleTx?: string): Promise<void> {
  const claimed = await transition(row, ['settling', 'ready'], 'settled', event, {
    settleTx,
    nextAttemptAt: null,
    resolution: null,
  });
  if (!claimed) return;
  metrics.inc('bridge_settled');
  const network = NETWORK_NAME[row.direction === 'in' ? row.source_chain : row.destination_chain] ?? '';
  await notifyBridgeSettled(row.user_id, Number(row.amount_usdc), network, row.direction);
}

/**
 * Companion-transfer confirmation hook — called from onTransferConfirmedAndNotify, which both the
 * Solana confirmer AND the Helius webhook funnel through. Outbound: the burn confirmed. Inbound:
 * the mint confirmed (terminal).
 */
export async function onBridgeCompanionConfirmed(transferId: string): Promise<void> {
  const row = await getBridgeByTransferId(transferId);
  if (!row) return;
  if (row.direction === 'out') {
    await transition(row, ['source_submitted'], 'source_confirmed', 'burn_confirmed', { nextAttemptAt: null });
  } else {
    await settle(row, 'mint_confirmed');
  }
}

let railsById: Map<string, Rail> | null = null;
export function registerRails(rails: Rail[]): void {
  railsById = new Map(rails.map((r) => [r.id, r]));
}

/** One poller pass: self-heal from companion status, then dispatch each due row to its rail. */
export async function advanceBridgeOnce(ctx: MachineCtx): Promise<void> {
  const due = await listBridgeDue();
  for (const row of due) {
    try {
      // Self-heal from the companion transfer's status (covers crashes between confirm + hook,
      // and burn failures — with zero changes to the Solana confirmer). Applies only where the
      // companion IS the leg being awaited: outbound source (the burn) and inbound settle (the
      // mint). Inbound source_submitted is an EVM receipt check — the rail owns it.
      if (
        (row.state === 'source_submitted' && row.direction === 'out') ||
        (row.state === 'settling' && row.direction === 'in')
      ) {
        const status = await getTransferStatusById(row.transfer_id);
        if (status === 'confirmed') {
          await onBridgeCompanionConfirmed(row.transfer_id);
          continue;
        }
        if (status === 'failed') {
          // Outbound: burn never landed (nothing left the wallet). Inbound settling: the mint tx
          // expired pre-confirmation — replay the attestation (funds are safe).
          if (row.state === 'source_submitted') {
            await transition(row, ['source_submitted'], 'failed', 'source_failed');
          } else {
            await transition(row, ['settling'], 'ready', 'settle_expired', {
              retryCount: row.retry_count + 1,
              nextAttemptAt: nextAttempt(row.retry_count + 1, 5_000, 60_000),
            });
          }
          continue;
        }
        // Companion still pending: give the confirmer room.
        await casBridgeState(row.id, [row.state], row.state, { nextAttemptAt: nextAttempt(0, 10_000, 10_000) });
        continue;
      }

      const rail = railsById?.get(row.rail);
      if (!rail) {
        ctx.log(`bridge: unknown rail '${row.rail}' for ${row.id} — parked 5m`);
        await casBridgeState(row.id, [row.state], row.state, { nextAttemptAt: nextAttempt(0, 300_000, 300_000) });
        continue;
      }
      await rail.advance(row, ctx);
    } catch (e) {
      ctx.log(`bridge advance error (${row.id}): ${String(e)}`);
      await casBridgeState(row.id, [row.state], row.state, {
        retryCount: row.retry_count + 1,
        nextAttemptAt: nextAttempt(row.retry_count + 1, 5_000, 120_000),
      });
    }
  }
}
