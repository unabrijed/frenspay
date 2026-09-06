// merchantStats.ts — M4 performance scoring. Recomputes each merchant's live signals
// (success_rate, avg_completion_secs, dispute_rate) from real order outcomes, smoothed toward the seed
// `base_*` priors so a low-volume LP isn't volatile, and auto-suspends any LP whose bond falls below
// MIN_BOND. M3 ranking reads the same columns, so routing self-corrects with no ranking-code change.
import {
  listAllMerchants,
  merchantActivityHours,
  merchantCompletionStats,
  merchantDisputeStats,
  merchantFeedbackStats,
  merchantOutcomeCounts,
  reinstateBondSuspendedMerchant,
  setMerchantStatus,
  updateMerchantActivity,
  updateMerchantStats,
  type MerchantRow,
} from '../db/queries';

const PRIOR_WEIGHT = 10; // k: pseudo-count of the seed prior (Bayesian smoothing)
const POSITIVE_PRIOR = 0.9; // payer-👍 prior — a code constant, unlike the per-merchant base_* seeds
/**
 * The stake floor: to go online, and to stay routable. Below it an LP is suspended (out of routing).
 *
 * $100 on purpose (docs/15, 2026-08-30): it equals the tier-1 payer's per-transaction cap
 * (compliance.ts KYC_TIERS[1].sendPerTx), and with tier-1 leverage at 1× a floor-bonded LP is
 * therefore fully collateralised for any single order they can be routed. The old $2,000 made the
 * bond do three jobs on one number — access price, loss cover, exposure cap — that only cohered
 * because it was large.
 */
export const MIN_BOND = 100;

/** How long a root admin's stake waiver lasts (0028). Re-grant to extend. */
export const WAIVER_DAYS = 30;

/** A root admin let this partner work before staking, and it has not lapsed (0028). */
export const bondWaived = (m: Pick<MerchantRow, 'bond_waived_until'>): boolean =>
  m.bond_waived_until != null && m.bond_waived_until.getTime() > Date.now();

/**
 * What routing lets a partner carry in flight: bond × the tier's leverage, except that below the
 * floor a live waiver is worth exactly MIN_BOND. Flat, never leveraged, so a waived partner at any
 * tier carries at most what a floor-bonded tier-1 partner would; at or above the floor the waiver is
 * moot. lockOrder mirrors this in SQL, and the two must agree or the pool shows work the lock refuses.
 */
export const bondCap = (m: Pick<MerchantRow, 'bond_usdc' | 'tier' | 'bond_waived_until'>): number => {
  const bond = Number(m.bond_usdc);
  return bond < MIN_BOND && bondWaived(m) ? MIN_BOND : bond * leverageFor(m.tier);
};

/**
 * An upheld dispute draws `min(bond, the order's USDC amount)` from the LP's bond — order-sized,
 * bond-bounded, and at tier 1 always fully collectable (in-flight ≤ bond). The draw is the
 * `greatest(bond − amount, 0)` clamp in queries.ts drawDownBond, passed the order amount; there is
 * no flat fine any more. The old flat $1,500 against a $100–300 floor floored to zero and turned
 * one dispute into a permanent exit.
 */

/**
 * How long after an order COMPLETES its bond stays claimable: a withdrawal (or an exit) is refused
 * while any of the LP's orders completed inside this window, and — the same constant, the other
 * side — a completed order can no longer be disputed once it is older than this. One number, so a
 * payer's right to dispute and an LP's right to leave can never disagree. Disclosed to both.
 */
export const DISPUTE_CLAW_WINDOW_H = 72;

/**
 * How much an LP may carry in flight per USDC of bond, by tier.
 *
 * `float_usdc` is self-declared and, until now, unrelated to `bond_usdc` — an LP with the minimum
 * bond could declare a million of float and take on exposure their stake could never cover.
 * Capping effective float at bond × leverage is the fix, and it doubles as the reward that costs
 * nothing: a proven LP's same stake carries more work, so their capital turns over faster.
 *
 * A code table, not a column: it is policy, and policy that lives in a row is policy an admin can
 * quietly change on one merchant.
 */
// Tier 1 is 1× — in flight ≤ bond — which is what makes MIN_BOND a real collateral floor rather
// than an entry fee (docs/15). The higher rungs remain the reward that costs nothing.
export const LEVERAGE: Record<number, number> = { 1: 1, 2: 3, 3: 5 };
export const leverageFor = (tier: number): number => LEVERAGE[tier] ?? LEVERAGE[1];

/**
 * The most an LP may add on top of the live mid, in bps, by tier — the platform sets the price
 * envelope, the LP picks inside it (decided 2026-08-24: "the tier based prices we do set up").
 * A proven LP has earned the right to a wider margin; an unproven one competes on price or not at
 * all. Same code-table-not-a-column reasoning as LEVERAGE above. The floor stays MIN_SPREAD_BPS.
 *
 * ponytail: placeholder rungs (1%/2%/3%) pending Bridge's real numbers — one line to retune.
 */
export const TIER_MAX_SPREAD_BPS: Record<number, number> = { 1: 100, 2: 200, 3: 300 };
export const spreadCapFor = (tier: number): number => TIER_MAX_SPREAD_BPS[tier] ?? TIER_MAX_SPREAD_BPS[1];

/**
 * Slots in the activity histogram: day-of-week × hour.
 *
 * Lives here, not in routing.ts, purely to keep the dependency one-way: routing already imports
 * MIN_BOND and leverageFor from this module, so putting these there and importing them back would
 * have made the two files circular — which happens to work under ESM for values read inside
 * function bodies, and silently breaks the day one is read at module scope.
 */
export const ACTIVITY_SLOTS = 168;

/**
 * Which slot "now" falls in. UTC, because the array is only ever used to compare LPs to each other
 * at the same instant — the zone just has to be the same on both sides of the comparison, and
 * converting to each LP's local time would not change the ordering.
 */
export function activitySlot(at: Date = new Date()): number {
  return at.getUTCDay() * 24 + at.getUTCHours();
}

/** Smooth an observed mean toward a prior with k pseudo-observations: (obs·n + prior·k)/(n + k). */
function smooth(obsMean: number, n: number, prior: number): number {
  if (n <= 0) return prior;
  return (obsMean * n + prior * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT);
}

/** The signals a tier is decided from. */
export interface TierSignals {
  settled: number;
  successRate: number;
  disputeRate: number;
  avgCompletionSecs: number;
}

/**
 * The tier ladder, as DATA rather than a chain of ifs — because the LP console has to tell an LP
 * what closes the gap to the next rung, and a number typed into a screen that drifts from the
 * number the router uses is worse than showing nothing.
 *
 * Volume gates each rung because the smoothed rates start at their priors: without it a brand-new
 * LP with one lucky order would read as tier 3 and be handed 8× leverage.
 *
 * Deliberately thresholds rather than a composite score. An LP has to read this and know what to
 * fix; "your composite fell to 0.71" is not something anyone can act on.
 *
 * Highest first — `tierFor` takes the first rule that passes.
 */
export const TIER_RULES: ReadonlyArray<{ tier: number } & Partial<TierSignals>> = [
  { tier: 3, settled: 50, successRate: 0.98, disputeRate: 0.01, avgCompletionSecs: 120 },
  { tier: 2, settled: 10, successRate: 0.95, disputeRate: 0.03 },
];

const meetsRule = (m: TierSignals, r: (typeof TIER_RULES)[number]): boolean =>
  (r.settled == null || m.settled >= r.settled) &&
  (r.successRate == null || m.successRate >= r.successRate) &&
  (r.disputeRate == null || m.disputeRate <= r.disputeRate) &&
  (r.avgCompletionSecs == null || m.avgCompletionSecs <= r.avgCompletionSecs);

function tierFor(m: TierSignals): number {
  return TIER_RULES.find((r) => meetsRule(m, r))?.tier ?? 1;
}

/**
 * What stands between this LP and the next rung — the whole motivational point of the console.
 *
 * Returns only the terms they do NOT yet meet, computed against the same rules `tierFor` uses, so
 * the screen can never promise a threshold the router disagrees with. Null at the top rung.
 */
export function tierProgress(
  m: TierSignals,
): { nextTier: number; leverage: number; needs: Array<{ key: string; have: number; need: number }> } | null {
  const current = tierFor(m);
  // The next rung up is the lowest rule above the current tier.
  const next = [...TIER_RULES].reverse().find((r) => r.tier > current);
  if (!next) return null;

  const needs: Array<{ key: string; have: number; need: number }> = [];
  if (next.settled != null && m.settled < next.settled) {
    needs.push({ key: 'settled', have: m.settled, need: next.settled });
  }
  if (next.successRate != null && m.successRate < next.successRate) {
    needs.push({ key: 'successRate', have: m.successRate, need: next.successRate });
  }
  if (next.disputeRate != null && m.disputeRate > next.disputeRate) {
    needs.push({ key: 'disputeRate', have: m.disputeRate, need: next.disputeRate });
  }
  if (next.avgCompletionSecs != null && m.avgCompletionSecs > next.avgCompletionSecs) {
    needs.push({ key: 'avgCompletionSecs', have: m.avgCompletionSecs, need: next.avgCompletionSecs });
  }
  return { nextTier: next.tier, leverage: leverageFor(next.tier), needs };
}

/** Recompute every merchant's live signals from history, and suspend any below the bond floor. */
export async function recomputeMerchantStats(log?: (m: string) => void): Promise<void> {
  const [merchants, outcomes, completion, disputes, feedback, activity] = await Promise.all([
    listAllMerchants(),
    merchantOutcomeCounts(),
    merchantCompletionStats(),
    merchantDisputeStats(),
    merchantFeedbackStats(),
    merchantActivityHours(ACTIVITY_SLOTS),
  ]);

  for (const m of merchants) {
    const oc = outcomes[m.id] ?? { released: 0, failed: 0, releasedRecent: 0, failedRecent: 0 };
    // Two windows on purpose (2026-08-24): `settled` stays LIFETIME because it is the tier VOLUME
    // gate — a rung earned by volume must not dissolve in a quiet quarter, which would cut
    // leverage under an LP's already-committed float. The RATE is 90-day, so what routing trusts
    // is what they've done lately, decaying toward the seed prior as old orders age out.
    const settled = oc.released + oc.failed;
    const settledRecent = oc.releasedRecent + oc.failedRecent;
    const successRate = smooth(
      settledRecent > 0 ? oc.releasedRecent / settledRecent : 0,
      settledRecent,
      Number(m.base_success_rate),
    );

    const cs = completion[m.id] ?? { avgSecs: 0, n: 0 };
    const avgCompletionSecs = smooth(cs.avgSecs, cs.n, m.base_avg_completion_secs);

    const ds = disputes[m.id] ?? { upheld: 0, completed: 0 };
    const disputeRate = smooth(ds.completed > 0 ? ds.upheld / ds.completed : 0, ds.completed, Number(m.base_dispute_rate));

    const fs = feedback[m.id] ?? { up: 0, n: 0 };
    const positiveRate = smooth(fs.n > 0 ? fs.up / fs.n : 0, fs.n, POSITIVE_PRIOR);

    // When they actually deliver, by hour. Only written when there IS history: leaving the column
    // NULL scores neutral, whereas writing 168 zeros would say "never around", which is a very
    // different and much worse claim about a merchant who simply hasn't traded yet.
    const hours = activity[m.id];
    if (hours) await updateMerchantActivity(m.id, hours);

    const tier = tierFor({ settled, successRate, disputeRate, avgCompletionSecs });
    // maxSpreadBps clamps the stored spread to the (possibly lower) new tier's cap in the same
    // write — a downgraded LP must not keep charging a price their tier no longer allows.
    await updateMerchantStats(m.id, {
      successRate,
      avgCompletionSecs,
      disputeRate,
      positiveRate,
      tier,
      maxSpreadBps: spreadCapFor(tier),
    });

    // Bond enforcement, now BOTH ways. Suspension stamps `suspend_reason = 'bond'` so the reinstate
    // below can tell its own decision apart from a human's — an admin suspension and the
    // user-suspend cascade write the same status through the same setter, and un-suspending those
    // on a bond top-up would silently undo moderation.
    // A live waiver (0028) stands in for the floor both ways: it holds the suspend off, and it lets
    // the reinstate below try. The SQL re-checks it, so one that lapses in between simply does nothing.
    const waived = bondWaived(m);
    if (Number(m.bond_usdc) < MIN_BOND && !waived && m.status === 'online') {
      await setMerchantStatus(m.id, 'suspended', 'bond');
      log?.(`merchant ${m.name} suspended (bond ${m.bond_usdc} < ${MIN_BOND})`);
    } else if (m.status === 'suspended' && m.suspend_reason === 'bond' && (Number(m.bond_usdc) >= MIN_BOND || waived)) {
      // Lands on 'offline' — solvent again is eligible-to-work, not back-at-the-desk. Before this,
      // an LP who topped up stayed suspended until an admin noticed, and the dev route only worked
      // on kyb_status='pending' rows, so there was effectively no way back at all.
      if (await reinstateBondSuspendedMerchant(m.id, MIN_BOND)) {
        log?.(`merchant ${m.name} reinstated to offline (bond ${m.bond_usdc}${waived ? ', waived' : ''})`);
      }
    }
  }
}
