// poller.ts — the bridge worker tick (kyc/poller skeleton: interval + re-entrancy guard + unref).
// Drives every due bridge row one step per pass via the rail registry. No-op without a DB or the
// EVM minter config, so Solana-only deployments run unchanged.
import { hasDatabase } from '../../db/pool';

import { evmMinterConfigured } from './cctp/evm';
import { advanceBridgeOnce } from './machine';
import './registry'; // side-effect: registers the rails with the machine

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startBridgePoller(intervalMs = 5_000, log: (m: string) => void = () => {}): void {
  if (timer || !hasDatabase()) return;
  if (!evmMinterConfigured()) {
    log('bridge poller: EVM minter not configured — cross-chain settles disabled');
    return;
  }
  timer = setInterval(() => {
    if (running) return;
    running = true;
    advanceBridgeOnce({ log })
      .catch((e) => log(`bridge poller error: ${String(e)}`))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref?.();
}
