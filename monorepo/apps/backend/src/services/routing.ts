// routing.ts — M3 matching engine. Ranks online merchants on a weighted composite score over
// normalized signals (reliability, cost, speed, dispute, queue depth, liquidity), and powers both the
// quote-time pick and auto-failover (re-rank excluding already-tried LPs). "A marketplace, not a DEX":
// invisible to the user, who just pays.
import type { PayoutMethod } from '@pay/shared';

import { countActiveOrdersByMerchant, listOnlineMerchants, type MerchantRow } from '../db/queries';

export interface RankedMerchant {
  merchant: MerchantRow;
  score: number; // composite, [0,1]
  queueDepth: number;
}

// Reliability-weighted, matching the architecture's "expose certainty". Weights sum to 1.
const WEIGHTS = { reliability: 0.35, cost: 0.2, speed: 0.2, dispute: 0.1, queue: 0.1, liquidity: 0.05 };

/** Min-max normalize to [0,1] across the pool; `invert` for lower-is-better signals. Flat pool → 1. */
function normalize(values: number[], invert: boolean): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((v) => {
    const t = (v - min) / (max - min);
    return invert ? 1 - t : t;
  });
}

/**
 * Rank eligible merchants best-first for an order of `amountUsdc`.
 * - hard filter: drop LPs that can't cover the order (float < amount) or are in `excludeIds`
 *   (already tried this order); keep the rail filter with a cross-rail fallback.
 * - score: weighted sum of normalized signals (reliability/cost/speed/dispute/queue/liquidity).
 */
export async function rankMerchants(input: {
  payoutMethod: PayoutMethod;
  amountUsdc: number;
  excludeIds?: string[];
}): Promise<RankedMerchant[]> {
  const exclude = new Set(input.excludeIds ?? []);
  const all = (await listOnlineMerchants()).filter((m) => !exclude.has(m.id));

  // Prefer the matching rail; fall back to any rail only if none match.
  const railed = all.filter((m) => m.payout_rail === input.payoutMethod);
  const byRail = railed.length > 0 ? railed : all;

  // Hard filter: the LP must be able to cover the order. If that empties the pool, fall back to byRail
  // so we still return something rankable (the caller decides whether to refund on an empty result).
  const covered = byRail.filter((m) => Number(m.float_usdc) >= input.amountUsdc);
  const pool = covered.length > 0 ? covered : byRail;
  if (pool.length === 0) return [];

  const queue = await countActiveOrdersByMerchant();
  const queueDepths = pool.map((m) => queue[m.id] ?? 0);

  const rel = normalize(pool.map((m) => Number(m.success_rate)), false);
  const cost = normalize(pool.map((m) => m.spread_bps), true);
  const speed = normalize(pool.map((m) => m.avg_completion_secs), true);
  const dispute = normalize(pool.map((m) => Number(m.dispute_rate)), true);
  const queueN = normalize(queueDepths, true);
  // Liquidity headroom: float relative to the order, capped at 5× (beyond that is no real advantage).
  const liq = normalize(
    pool.map((m) => Math.min(Number(m.float_usdc) / Math.max(input.amountUsdc, 1), 5)),
    false,
  );

  return pool
    .map((m, i) => ({
      merchant: m,
      queueDepth: queueDepths[i],
      score:
        WEIGHTS.reliability * rel[i] +
        WEIGHTS.cost * cost[i] +
        WEIGHTS.speed * speed[i] +
        WEIGHTS.dispute * dispute[i] +
        WEIGHTS.queue * queueN[i] +
        WEIGHTS.liquidity * liq[i],
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.merchant.success_rate) - Number(a.merchant.success_rate) ||
        a.merchant.spread_bps - b.merchant.spread_bps,
    );
}

/** Back-compat: the single best merchant for a quote (or null). */
export async function pickMerchant(input: {
  payoutMethod: PayoutMethod;
  amountUsdc?: number;
}): Promise<MerchantRow | null> {
  const ranked = await rankMerchants({ payoutMethod: input.payoutMethod, amountUsdc: input.amountUsdc ?? 0 });
  return ranked[0]?.merchant ?? null;
}
