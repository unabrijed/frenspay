// confirmer.ts — M2 transfer confirmation.
// Dev: poll on-chain status for pending transfers and flip the DB row. Prod also has the
// Helius webhook (POST /webhooks/helius) for push confirmation; this poller is the fallback.
import { config } from '../config';
import { hasDatabase } from '../db/pool';
import { expireStaleUnsignedTransfers, getPendingSignatures, getSendNotifyInfo, setTransferStatus } from '../db/queries';

import { recomputeMerchantStats } from './merchantStats';
import { notifyReceived } from './notify';
import { onTransferConfirmed } from './orderMachine';
import { sweepRateLimitWindows } from './rateLimit';
import { runOrderWorkerOnce } from './simMerchant';
import { getTransferStatus } from './solana';

let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;
let running = false; // re-entrancy guard: a slow pass must not overlap the next tick

/** One pass: resolve every pending+broadcast transfer and persist a terminal status. */
export async function confirmPendingOnce(log?: (m: string) => void): Promise<void> {
  const pending = await getPendingSignatures();
  for (const t of pending) {
    const status = await getTransferStatus(t.signature);
    if (status !== 'pending') {
      await setTransferStatus(t.id, status);
      log?.(`transfer ${t.id} → ${status}`);
      // Advance any order linked to this escrow transfer (fund → payment_detected, release → completed).
      if (status === 'confirmed') {
        await onTransferConfirmed(t.id);
        // M6: notify the recipient of a confirmed P2P send ("Neha sent you $5").
        const recv = await getSendNotifyInfo(t.id);
        if (recv) await notifyReceived(recv.toUserId, recv.amountUsd, recv.fromHandle);
      }
    }
  }
  sweepRateLimitWindows(); // M6: drop expired rate-limit windows so the Map can't grow unbounded

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
