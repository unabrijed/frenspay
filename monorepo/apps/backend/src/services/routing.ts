// routing.ts — M3 matching engine, M4-aware. Ranks routable (online + KYB-approved) merchants on a
// weighted composite score over normalized signals (reliability, cost, speed, dispute, liquidity), and
// powers both the quote-time pick and auto-failover (re-rank excluding already-tried LPs). The signals
// are kept live by M4's recompute; float is committed by in-flight orders. "A marketplace, not a DEX":
// invisible to the user, who just pays.
import type { PayoutMethod } from '@fpay/shared';

import { blockedMerchantsForPayee, committedFloatByMerchant, listRoutableMerchants, type MerchantRow } from '../db/queries';
import { amt, USDC_DECIMALS } from '../lib/amount';
import { CORRIDORS } from '../lib/corridors';
import { type Amount, BN, divUp, RATE_DECIMALS } from '../lib/units';

import { ACTIVITY_SLOTS, activitySlot, leverageFor, MIN_BOND } from './merchantStats';

export interface RankedMerchant {
  merchant: MerchantRow;
  score: number; // composite, [0,1]
  availableFloat: number; // float − in-flight commitments
}

/**
 * The pair rule's cooldown: how long after paying a receiver an LP is barred from paying that same
 * receiver again. A personal account paying the same handle repeatedly is the documented
 * account-freeze pattern (docs/08), so this is a hard filter at every attach point, never a score.
 * "Multiple months" — decided 2026-08-21; doubled to half a year 2026-08-24. Raising it re-blocks
 * pairs whose claims are 91–180 days old the moment it deploys — accepted, watched via the
 * routing_* metrics rather than softened.
 */
export const PAYEE_COOLDOWN_DAYS = 180;

/** Most LPs one payment may be split across. Bounds the deposit tx (each leg is one more escrow
 *  PDA) and how many separate credits a receiver has to reconcile. */
export const MAX_LEGS = 3;

/** Smallest leg worth waking a human LP for, in USDC. Applies to splits only — a whole order below
 *  this is bounded by MIN_ORDER_USD at the route, not here. */
export const MIN_LEG_USDC = 5;

/**
 * How recently an LP must have been seen for us to believe they'll act on an order now.
 *
 * `avg_completion_secs` is a historical average over orders this LP eventually completed. It is a
 * fine ranking signal and a bad promise: an LP who averages 90 seconds while awake averages nothing
 * at all while asleep, and quoting their history as an ETA tells the payer a number that was never
 * true of the order in front of them.
 */
export const WARM_WINDOW_MS = 120_000;

export { ACTIVITY_SLOTS, activitySlot };

export const isWarm = (m: MerchantRow): boolean =>
  // Non-human rows are always warm. `last_seen_at` is written by authenticated merchant-portal
  // requests, and a platform ('psp') or sim row has no user_id and therefore never makes one — so
  // treating them as cold made EVERY quote on a provider corridor widen its ETA to the human claim
  // SLA, an SLA that does not even apply to them. A vendor API does not go to sleep.
  m.sim_behavior != null ||
  (m.last_seen_at != null && Date.now() - m.last_seen_at.getTime() < WARM_WINDOW_MS);

// Reliability-weighted, matching the architecture's "expose certainty". Weights sum to 1. (M4 folded the
// M3 queue-depth signal into liquidity, since available float already reflects an LP's live load;
// `rating` is the payer-👍 positive_rate — human-reported, so it gets its own modest term.)
// Two signals about AVAILABILITY joined the six about quality (0014/0017), and every existing
// weight shrank proportionally to pay for them rather than one being singled out.
//
// The reasoning: the best LP in the pool is worth nothing to a payer standing in a shop if they are
// asleep. `warm` (seen in the last two minutes) is the strong one — it is a fact about right now.
// `activity` (this hour, historically) is the weak one, a prediction, and it is the smallest weight
// of the eight on purpose: with a handful of LPs per corridor those counts are noise, and it should
// have to earn any more than that from real data.
const WEIGHTS = {
  reliability: 0.26,
  cost: 0.18,
  speed: 0.12,
  dispute: 0.08,
  rating: 0.08,
  liquidity: 0.12,
  warm: 0.12,
  activity: 0.04,
};

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
  /** Who the fiat is for. When set, every LP the pair rule bars from this receiver is excluded —
   *  same rule the lock re-checks in SQL, so a quote can never promise an LP the lock would refuse. */
  payee?: string | null;
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
  const blocked = input.payee ? await blockedMerchantsForPayee(input.payee, PAYEE_COOLDOWN_DAYS) : [];
  return rankPool(eligible, await committedFloatByMerchant(), {
    amountUsdc: input.amountUsdc,
    excludeIds: [...(input.excludeIds ?? []), ...blocked],
  });
}

/** The LP's rate at a spread: fiat per USDC off the live mid, rounded DOWN (less fiat per USDC, so
 *  the USDC owed rounds up and the LP is never short — docs/01 money law). */
export const lpRateAt = (mid: number, spreadBps: number): Amount =>
  amt(mid)
    .times(10_000 - spreadBps)
    .div(10_000)
    .dp(RATE_DECIMALS, BN.ROUND_DOWN);

export interface Leg {
  merchant: MerchantRow;
  /** This leg's fiat, in whole minor units of the currency. */
  amountFiat: Amount;
  /** What this LP is owed for it — `divUp(amountFiat, lpRate)`, so no leg is ever short. */
  amountUsdc: Amount;
}

export interface LegPlan {
  legs: Leg[];
  /** The spread the whole quote is struck at: the dearest leg's. One price per quote, or the lock's
   *  `m.spread_bps <= q.spread_bps` would refuse a dearer leg's own provisional LP. */
  spreadBps: number;
  lpRate: Amount;
}

/**
 * Split by necessity only. `ranked` is best-first; the first LP who can carry the whole amount at
 * their own rate gets it as one leg. Only when nobody can does the payment become N legs on N
 * distinct LPs, each sized to what that LP's headroom covers, N ≤ MAX_LEGS. Null = refuse the quote.
 *
 * Pure, so the money law below can be asserted with no database (check-routing-math.ts):
 * - every leg's fiat is whole minor units and the legs sum to `amountFiat` exactly;
 * - every leg's USDC is `divUp(fiat, lpRate)` — the LP is never short, the payer pays at most
 *   (n−1) µUSDC more than a single leg would have cost;
 * - every leg's USDC fits that LP's headroom (the cap is walked back one minor unit when rounding
 *   up would not);
 * - no split leg is below MIN_LEG_USDC — a sliver is moved off the largest leg, or the plan is refused.
 *
 * The rate depends on the set (the dearest spread) and the sizes depend on the rate, so the set is
 * grown one LP at a time: spread only rises with n, so capacity only falls, so an LP who could not
 * cover the rest at n−1 still cannot at n, and the n-th leg is always non-empty.
 */
export function planLegs(ranked: RankedMerchant[], amountFiat: Amount, mid: number, fdp: number): LegPlan | null {
  const minor = amt(1).shiftedBy(-fdp);
  for (let n = 1; n <= Math.min(MAX_LEGS, ranked.length); n++) {
    // ponytail: best-first greedy. Fewest-legs packing only if MAX_LEGS refusals ever show up in metrics.
    const set = ranked.slice(0, n);
    const spreadBps = Math.max(...set.map((r) => r.merchant.spread_bps));
    const lpRate = lpRateAt(mid, spreadBps);
    const caps = set.map((r) => {
      const headroom = amt(r.availableFloat);
      let cap = headroom.times(lpRate).dp(fdp, BN.ROUND_DOWN);
      if (divUp(cap, lpRate, USDC_DECIMALS).gt(headroom)) cap = cap.minus(minor);
      return cap;
    });
    if (caps.reduce((s, c) => s.plus(c), amt(0)).lt(amountFiat)) continue;

    const fiat: Amount[] = [];
    let remaining = amountFiat;
    for (const cap of caps) {
      const f = BN.min(remaining, cap);
      fiat.push(f);
      remaining = remaining.minus(f);
    }
    if (n > 1) {
      const last = n - 1;
      const minFiat = amt(MIN_LEG_USDC).times(lpRate).dp(fdp, BN.ROUND_UP);
      if (fiat[last].lt(minFiat)) {
        const deficit = minFiat.minus(fiat[last]);
        const j = fiat.slice(0, last).reduce((best, f, i, arr) => (f.gt(arr[best]) ? i : best), 0);
        if (fiat[j].minus(deficit).lt(minFiat) || minFiat.gt(caps[last])) return null;
        fiat[j] = fiat[j].minus(deficit);
        fiat[last] = minFiat;
      }
    }
    return {
      legs: set.map((r, i) => ({
        merchant: r.merchant,
        amountFiat: fiat[i],
        amountUsdc: divUp(fiat[i], lpRate, USDC_DECIMALS),
      })),
      spreadBps,
      lpRate,
    };
  }
  return null;
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
  // Availability. Both are 1 across a uniform pool (normalize's flat-pool rule), so a corridor
  // where nobody is warm ranks on quality alone rather than collapsing to a tie at zero.
  const warm = normalize(pool.map((m) => (isWarm(m) ? 1 : 0)), false);
  const slot = activitySlot();
  const activity = normalize(pool.map((m) => m.active_hours?.[slot] ?? 0), false);
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
        WEIGHTS.warm * warm[i] +
        WEIGHTS.activity * activity[i] +
        WEIGHTS.liquidity * liq[i],
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.merchant.success_rate) - Number(a.merchant.success_rate) ||
        a.merchant.spread_bps - b.merchant.spread_bps,
    );
}
