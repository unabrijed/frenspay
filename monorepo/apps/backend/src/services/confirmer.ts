// confirmer.ts — M2 transfer confirmation.
// Dev: poll on-chain status for pending transfers and flip the DB row. Prod also has the
// Helius webhook (POST /webhooks/helius) for push confirmation; this poller is the fallback.
import { config } from '../envConfig';
import { hasDatabase } from '../db/pool';
import { expireStaleUnsignedTransfers, listPendingSolanaTransfers, setTransferStatus } from '../db/queries';

import { recomputeMerchantStats } from './merchantStats';
import { onTransferConfirmedAndNotify, reconcilePoolDeposits } from './orderMachine';
import { runOrderWorkerOnce } from './simMerchant';
import { verifiedStatus } from './transferVerify';

let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;
let running = false; // re-entrancy guard: a slow pass must not overlap the next tick

/** One pass: resolve every pending+broadcast transfer and persist a terminal status. */
export async function confirmPendingOnce(log?: (m: string) => void): Promise<void> {
  const pending = await listPendingSolanaTransfers();
  for (const t of pending) {
    // One row at a time, and one row's failure stays its own: a 429 from the RPC or a downstream
    // handler throwing used to abort the whole pass here, which silently skipped the order worker
    // below — no lock expired, no escalation ran, no refund fired — every tick until it cleared.
    try {
      // Landed AND moved what the row says (transferVerify.ts) — the second question is asked here,
      // before the flip, so nothing downstream can see a confirmed row the chain does not back.
      const status = await verifiedStatus(t);
      if (status === 'pending') continue;
      // Only act on a real transition — if the webhook finalized this row first, don't double-advance/notify.
      const changed = await setTransferStatus(t.id, status);
      if (changed) {
        log?.(`transfer ${t.id} → ${status}`);
        // Advance any order linked to this escrow transfer + notify the recipient of a confirmed P2P send.
        if (status === 'confirmed') await onTransferConfirmedAndNotify(t.id);
      }
    } catch (e) {
      log?.(`transfer ${t.id}: ${String(e)}`);
    }
  }
  // Money the chain holds that the DB has not seen: read the vaults BEFORE anything below can expire
  // an order as unfunded.
  await reconcilePoolDeposits(log);

  // Retire transfers prepared but never signed (user abandoned before broadcast).
  const expired = await expireStaleUnsignedTransfers();
  if (expired > 0) log?.(`expired ${expired} stale unsigned transfer(s)`);

  // Drive the simulated merchant/LP + order escalation timers.
  await runOrderWorkerOnce(log);

  // M4: refresh merchant performance signals periodically (every ~10th tick — it scans order history,
  // so we don't run it every pass). Routing reads the columns this updates.
  if (++tick % 10 === 0) await recomputeMerchantStats(log);
}

/** Start the background poller. No-op without a DB + configured mint. */
export function startConfirmer(intervalMs = 8000, log?: (m: string) => void): void {
  if (timer || !hasDatabase() || !config.usdcMint) return;
  timer = setInterval(() => {
    if (running) return; // previous pass still in flight (slow RPC) — skip this tick
    running = true;
    confirmPendingOnce(log)
      .catch((e) => log?.(`confirmer error: ${String(e)}`))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref?.();
}
