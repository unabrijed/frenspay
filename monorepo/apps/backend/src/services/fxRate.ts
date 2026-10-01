// fxRate.ts — live FX, per-currency since the Indonesia corridor (M7 built it INR-only). ONE fetch
// serves every currency — the free source returns a full `rates` map — but each currency has its own
// cache slot, plausibility band, and fallback, so a bad/garbage value in one can never poison
// another's quote. getMidRate(ccy) is sync (returns the cached value, or the configured fallback
// before the first successful fetch) — quoting never blocks on the network. startFxRefresher()
// keeps the cache warm in the background. The merchant spread is applied on top in quoteEngine;
// this is the spread-free mid.
import { config } from '../envConfig';

/**
 * The currencies quotes can price in + their plausibility bands (units per USD); outside the band
 * we distrust the source. Per-currency on purpose: a single band can't hold both INR (~95) and IDR
 * (~17,900), and a band that admits both would wave a wrong-currency value through. MIRRORS the
 * rail currencies in packages/shared/src/rails.ts (backend `import type` rule — see lib/units.ts
 * header); check-fx.ts keeps it honest.
 */
export const FX_BANDS: Record<string, { min: number; max: number }> = {
  INR: { min: 50, max: 150 },
  SGD: { min: 0.5, max: 2.5 }, // Singapore display/sandbox pricing; NOT a live payment corridor
  IDR: { min: 12_000, max: 25_000 }, // live ≈ 17,900 (2026-08) with headroom; still rejects an INR-magnitude value
};

const cache: Record<string, { rate: number; fetchedAt: number }> = {};

/** Extract + validate `rates[ccy]` from a source payload. Null if the currency is unknown to us,
 *  or the value is missing / non-finite / outside the band. */
export function parseRate(body: unknown, ccy: string): number | null {
  const band = FX_BANDS[ccy];
  if (!band) return null;
  const v = (body as { rates?: Record<string, number> } | null)?.rates?.[ccy];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < band.min || v > band.max) return null;
  return Number(v.toFixed(4));
}

/** The current mid rate for `ccy` (cached), or the configured fallback until a fetch lands.
 *  Throws on a currency with no band/fallback — a typo here must never price a quote. */
export function getMidRate(ccy: string = 'INR'): number {
  const v = cache[ccy]?.rate ?? config.fxFallbackRates[ccy];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`no FX rate for ${ccy}`);
  // 4dp either way. A live rate is rounded on ingest (parseRate); the fallback is operator text at
  // whatever precision was typed. The quote stores this exact number as evidence (quotes.mid_rate,
  // 0029) with formatAmount, which refuses extra precision rather than round it, so what priced the
  // order and what the record says have to be the same value.
  return Number(v.toFixed(4));
}

/** ISO timestamp of the last good rate for `ccy`, or null while still on the fallback. */
export function getMidRateAsOf(ccy: string = 'INR'): string | null {
  const at = cache[ccy]?.fetchedAt;
  return at ? new Date(at).toISOString() : null;
}

/** Fetch once, validate + cache every banded currency independently. Never throws; a currency whose
 *  value is missing/insane keeps its previous good value (or fallback) — no cross-poisoning. */
export async function refreshMidRate(log?: (m: string) => void, url = config.fxSourceUrl): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const body: unknown = await res.json();
    const got: string[] = [];
    for (const ccy of Object.keys(FX_BANDS)) {
      const rate = parseRate(body, ccy);
      if (rate == null) continue;
      cache[ccy] = { rate, fetchedAt: Date.now() };
      got.push(`${ccy} ${rate}`);
    }
    if (!got.length) throw new Error('no rate in range for any currency');
    log?.(`fx: 1 USD = ${got.join(' · ')}`);
  } catch (e) {
    log?.(`fx refresh failed (${String(e)}); keeping last-good/fallback rates`);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Prime the rates once + refresh on an interval. Idempotent; unref'd so it never holds the process open. */
export function startFxRefresher(intervalMs = config.fxRefreshMs, log?: (m: string) => void): void {
  if (timer) return;
  void refreshMidRate(log);
  timer = setInterval(() => void refreshMidRate(log), intervalMs);
  timer.unref?.();
}

/** Test seam: reset every slot to the fallback (used by check-fx). */
export function _resetFxCacheForTest(): void {
  for (const k of Object.keys(cache)) delete cache[k];
}
