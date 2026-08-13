// routing.ts — M3 matching engine, M4-aware. Ranks routable (online + KYB-approved) merchants on a
// weighted composite score over normalized signals (reliability, cost, speed, dispute, liquidity), and
// powers both the quote-time pick and auto-failover (re-rank excluding already-tried LPs). The signals
// are kept live by M4's recompute; float is committed by in-flight orders. "A marketplace, not a DEX":
// invisible to the user, who just pays.
import type { PayoutMethod } from '@fpay/shared';

import { committedFloatByMerchant, listRoutableMerchants, type MerchantRow } from '../db/queries';
import { CORRIDORS } from '../lib/corridors';

import { leverageFor, MIN_BOND } from './merchantStats';

export interface RankedMerchant {
  merchant: MerchantRow;
  score: number; // composite, [0,1]
  availableFloat: number; // float − in-flight commitments
}

/**
 * How recently an LP must have been seen for us to believe they'll act on an order now.
 *
 * `avg_completion_secs` is a historical average over orders this LP eventually completed. It is a
 * fine ranking signal and a bad promise: an LP who averages 90 seconds while awake averages nothing
 * at all while asleep, and quoting their history as an ETA tells the payer a number that was never
 * true of the order in front of them.
 */
export const WARM_WINDOW_MS = 120_000;

export const isWarm = (m: MerchantRow): boolean =>
  m.last_seen_at != null && Date.now() - m.last_seen_at.getTime() < WARM_WINDOW_MS;

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
 * - hard filters, all in SQL (listRoutableMerchants): online, KYB-approved, same rail, same country,
 *   bond at or above the floor. Plus, here: `excludeIds` (already tried this order) and available
 *   float. Anything that must never be offered an order is a hard filter, never a low score.
 * - score: weighted sum of normalized signals (reliability/cost/speed/dispute/rating/liquidity).
 */
export async function rankMerchants(input: {
  payoutMethod: PayoutMethod;
  amountUsdc: number;
  excludeIds?: string[];
}): Promise<RankedMerchant[]> {
  // Country comes from the corridor, which mirrors rails.ts — the only country list (invariant 1).
  // Today this is implied by the rail (UPI is India, QRIS is Indonesia), so the filter is nearly a
  // tautology; it stops being one the first time a rail runs in more than one country, which 'bank'
  // already does in the real world. The column is what makes it enforceable then.
  //
  // Rail is a HARD filter (project-model invariant 15). The old any-rail fallback leaked money
  // both directions once corridors stopped being interchangeable: a rerouted QRIS order's escrow
  // could release to a 'happy' UPI sim that never paid the payee, and a UPI order could quote
  // against the QRIS platform settlement row into a guaranteed refund round-trip. An empty rail
  // pool now fails fast — `createQuote` → no_merchant, `rerouteOrder` → refund.
  const corridor = CORRIDORS[input.payoutMethod];
  if (!corridor) return []; // unquotable rail — fail fast rather than rank an empty concept

  const eligible = await listRoutableMerchants({
    payoutRail: input.payoutMethod,
    country: corridor.country,
    minBondUsdc: MIN_BOND,
  });
  return rankPool(eligible, await committedFloatByMerchant(), input);
}

/**
 * The pure half: given an already-eligible pool and each LP's in-flight commitments, apply the
 * remaining hard filters and score. Split out from `rankMerchants` so the capacity math and the
 * scoring can be asserted without a database (scripts/check-routing.ts, invariant 10) — this is
 * money-shaped logic and it was the only part of the router with no runnable check at all.
 */
export function rankPool(
  eligible: MerchantRow[],
  committed: Record<string, number>,
  input: { amountUsdc: number; excludeIds?: string[] },
): RankedMerchant[] {
  const exclude = new Set(input.excludeIds ?? []);
  const notTried = eligible.filter((m) => !exclude.has(m.id));

  // Live available float = min(declared float, bond × leverage) − committed (in-flight).
  //
  // The bond cap is the half that's new. `float_usdc` is the LP's own claim about their capacity and
  // nothing checked it against their stake, so a minimum-bond LP could declare unbounded float and
  // be routed unbounded exposure. Their stake is what makes the trade trustable, so it is what
  // bounds the trade. A saturated LP still drops out until its orders clear.
  //
  // Platform settlement rows are exempt (invariant 14, and the same reasoning settleDispute uses):
  // their bond is a seeded fiction with no top-up path, so leveraging it would quietly cut the
  // Indonesia corridor's capacity from its declared float to 3× a number that means nothing.
  const availableOf = (m: MerchantRow) => {
    const declared = Number(m.float_usdc);
    const backed =
      m.sim_behavior === 'psp' ? declared : Math.min(declared, Number(m.bond_usdc) * leverageFor(m.tier));
    return Math.max(backed - (committed[m.id] ?? 0), 0);
  };

  // Hard filter (truly hard): only LPs whose available float can cover the order. If none can, return
  // [] so the caller fails fast — `createQuote` → `no_merchant`, `rerouteOrder` → refund — rather than
  // routing real money to an LP that provably can't service it.
  // money:number — routing's amountUsdc is a local threshold value, not the wire DTO field of the
  // same name. Ranking compares and scores, it never moves money, so it stays on `number` by
  // decision (docs/01 § Money & decimals); a 1-ulp difference only shifts an exact-boundary tie.
  const pool = notTried.filter((m) => availableOf(m) >= input.amountUsdc);
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
