// routing.ts — M3 matching engine, M4-aware. Ranks routable (online + KYB-approved) merchants on a
// weighted composite score over normalized signals (reliability, cost, speed, dispute, liquidity), and
// powers both the quote-time pick and auto-failover (re-rank excluding already-tried LPs). The signals
// are kept live by M4's recompute; float is committed by in-flight orders. "A marketplace, not a DEX":
// invisible to the user, who just pays.
import type { PayoutMethod } from '@fpay/shared';

import { committedFloatByMerchant, listRoutableMerchants, type MerchantRow } from '../db/queries';

export interface RankedMerchant {
  merchant: MerchantRow;
  score: number; // composite, [0,1]
  availableFloat: number; // float − in-flight commitments
}

// Reliability-weighted, matching the architecture's "expose certainty". Weights sum to 1. (M4 folded the
// M3 queue-depth signal into liquidity, since available float already reflects an LP's live load;
// `rating` is the payer-👍 positive_rate — human-reported, so it gets its own modest term.)
const WEIGHTS = { reliability: 0.3, cost: 0.2, speed: 0.15, dispute: 0.1, rating: 0.1, liquidity: 0.15 };

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
 * - hard filter: drop LPs whose **available** float (total − in-flight) can't cover the order, and any
 *   in `excludeIds` (already tried this order); keep the rail filter with a cross-rail fallback.
 * - score: weighted sum of normalized signals (reliability/cost/speed/dispute/liquidity).
 */
export async function rankMerchants(input: {
  payoutMethod: PayoutMethod;
  amountUsdc: number;
  excludeIds?: string[];
}): Promise<RankedMerchant[]> {
  const exclude = new Set(input.excludeIds ?? []);
  const all = (await listRoutableMerchants()).filter((m) => !exclude.has(m.id));

  // Prefer the matching rail; fall back to any rail only if none match.
  const railed = all.filter((m) => m.payout_rail === input.payoutMethod);
  const byRail = railed.length > 0 ? railed : all;

  // Live available float = total float − committed (in-flight) float. A saturated LP has little
  // headroom and drops out until its orders clear.
  const committed = await committedFloatByMerchant();
  const availableOf = (m: MerchantRow) => Math.max(Number(m.float_usdc) - (committed[m.id] ?? 0), 0);

  // Hard filter (truly hard): only LPs whose available float can cover the order. If none can, return
  // [] so the caller fails fast — `createQuote` → `no_merchant`, `rerouteOrder` → refund — rather than
  // routing real money to an LP that provably can't service it.
  // money:number — routing's amountUsdc is a local threshold value, not the wire DTO field of the
  // same name. Ranking compares and scores, it never moves money, so it stays on `number` by
  // decision (docs/01 § Money & decimals); a 1-ulp difference only shifts an exact-boundary tie.
  const pool = byRail.filter((m) => availableOf(m) >= input.amountUsdc);
  if (pool.length === 0) return [];

  const avail = pool.map(availableOf);
  const rel = normalize(pool.map((m) => Number(m.success_rate)), false);
  const cost = normalize(pool.map((m) => m.spread_bps), true);
  const speed = normalize(pool.map((m) => m.avg_completion_secs), true);
  const dispute = normalize(pool.map((m) => Number(m.dispute_rate)), true);
  const rating = normalize(pool.map((m) => Number(m.positive_rate)), false);
  // Liquidity headroom: available float relative to the order, capped at 5× (beyond is no real edge).
  const liq = normalize(
    avail.map((a) => Math.min(a / Math.max(input.amountUsdc, 1), 5)),
    false,
  );

  return pool
    .map((m, i) => ({
      merchant: m,
      availableFloat: avail[i],
      score:
        WEIGHTS.reliability * rel[i] +
        WEIGHTS.cost * cost[i] +
        WEIGHTS.speed * speed[i] +
        WEIGHTS.dispute * dispute[i] +
        WEIGHTS.rating * rating[i] +
        WEIGHTS.liquidity * liq[i],
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.merchant.success_rate) - Number(a.merchant.success_rate) ||
        a.merchant.spread_bps - b.merchant.spread_bps,
    );
}
