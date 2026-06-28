// fxRate.ts — M7 live FX. The INR-per-USD mid rate, fetched from a free, no-key source, cached, and
// RANGE-VALIDATED so a bad/garbage API response can never poison a quote. getMidRate() is sync (returns
// the cached value, or the configured fallback before the first successful fetch) — quoting never blocks
// on the network. startFxRefresher() keeps the cache warm in the background. The merchant spread is
// applied on top in quoteEngine; this is the spread-free mid.
import { config } from '../config';

const SANE_MIN = 50; // INR per USD — a plausibility band; outside this we distrust the source.
const SANE_MAX = 150;

let cached = { rate: config.fxFallbackRate, fetchedAt: 0 };

/** Extract + validate `rates.INR` from a source payload. Returns null if missing / non-finite / insane. */
export function parseRate(body: unknown): number | null {
  const inr = (body as { rates?: Record<string, number> } | null)?.rates?.INR;
  if (typeof inr !== 'number' || !Number.isFinite(inr) || inr < SANE_MIN || inr > SANE_MAX) return null;
  return Number(inr.toFixed(4));
}

/** The current INR-per-USD mid rate (cached). Falls back to config.fxFallbackRate until a fetch lands. */
export function getMidRate(): number {
  return cached.rate;
}

/** ISO timestamp of the last good rate, or null while still on the fallback. */
export function getMidRateAsOf(): string | null {
  return cached.fetchedAt ? new Date(cached.fetchedAt).toISOString() : null;
}

/** Fetch + validate + cache the live rate. Never throws; on any failure keeps the previous good value. */
export async function refreshMidRate(log?: (m: string) => void, url = config.fxSourceUrl): Promise<number> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const rate = parseRate(await res.json());
    if (rate == null) throw new Error('rate missing or out of range');
    cached = { rate, fetchedAt: Date.now() };
    log?.(`fx: 1 USD = ₹${rate}`);
  } catch (e) {
    log?.(`fx refresh failed (${String(e)}); keeping ₹${cached.rate}`);
  }
  return cached.rate;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Prime the rate once + refresh on an interval. Idempotent; unref'd so it never holds the process open. */
export function startFxRefresher(intervalMs = config.fxRefreshMs, log?: (m: string) => void): void {
  if (timer) return;
  void refreshMidRate(log);
  timer = setInterval(() => void refreshMidRate(log), intervalMs);
  timer.unref?.();
}

/** Test seam: reset the cache to the fallback (used by check-fx). */
export function _resetFxCacheForTest(): void {
  cached = { rate: config.fxFallbackRate, fetchedAt: 0 };
}
