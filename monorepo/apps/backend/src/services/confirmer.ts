// confirmer.ts — M2 transfer confirmation.
// Dev: poll on-chain status for pending transfers and flip the DB row. Prod also has the
// Helius webhook (POST /webhooks/helius) for push confirmation; this poller is the fallback.
import { config } from '../config';
import { hasDatabase } from '../db/pool';
import { expireStaleUnsignedTransfers, getPendingSignatures, setTransferStatus } from '../db/queries';

import { getTransferStatus } from './solana';

let timer: ReturnType<typeof setInterval> | null = null;

/** One pass: resolve every pending+broadcast transfer and persist a terminal status. */
export async function confirmPendingOnce(log?: (m: string) => void): Promise<void> {
  const pending = await getPendingSignatures();
  for (const t of pending) {
    const status = await getTransferStatus(t.signature);
    if (status !== 'pending') {
      await setTransferStatus(t.id, status);
      log?.(`transfer ${t.id} → ${status}`);
    }
  }
  // Retire transfers prepared but never signed (user abandoned before broadcast).
  const expired = await expireStaleUnsignedTransfers();
  if (expired > 0) log?.(`expired ${expired} stale unsigned transfer(s)`);
}

/** Start the background poller. No-op without a DB + configured mint. */
export function startConfirmer(intervalMs = 8000, log?: (m: string) => void): void {
  if (timer || !hasDatabase() || !config.usdcMint) return;
  timer = setInterval(() => {
    confirmPendingOnce(log).catch((e) => log?.(`confirmer error: ${String(e)}`));
  }, intervalMs);
  timer.unref?.();
}
