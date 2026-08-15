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
} from '../db/queries';

const PRIOR_WEIGHT = 10; // k: pseudo-count of the seed prior (Bayesian smoothing)
const POSITIVE_PRIOR = 0.9; // payer-👍 prior — a code constant, unlike the per-merchant base_* seeds
export const MIN_BOND = 2000; // below this, an LP is suspended (out of routing)
export const DISPUTE_PENALTY_USDC = 1500; // flat bond fine drawn per upheld dispute

/**
 * How much an LP may carry in flight per USDC of bond, by tier.
 *
 * `float_usdc` is self-declared and, until now, unrelated to `bond_usdc` — an LP with the minimum
 * 2,000 bond could declare a million of float and take on exposure their stake could never cover.
 * Capping effective float at bond × leverage is the fix, and it doubles as the reward that costs
 * nothing: a proven LP's same stake carries more work, so their capital turns over faster.
 *
 * A code table, not a column: it is policy, and policy that lives in a row is policy an admin can
 * quietly change on one merchant.
 */
export const LEVERAGE: Record<number, number> = { 1: 3, 2: 5, 3: 8 };
export const leverageFor = (tier: number): number => LEVERAGE[tier] ?? LEVERAGE[1];

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
    const oc = outcomes[m.id] ?? { released: 0, failed: 0 };
    const settled = oc.released + oc.failed;
    const successRate = smooth(settled > 0 ? oc.released / settled : 0, settled, Number(m.base_success_rate));

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
    await updateMerchantStats(m.id, { successRate, avgCompletionSecs, disputeRate, positiveRate, tier });

    // Bond enforcement, now BOTH ways. Suspension stamps `suspend_reason = 'bond'` so the reinstate
    // below can tell its own decision apart from a human's — an admin suspension and the
    // user-suspend cascade write the same status through the same setter, and un-suspending those
    // on a bond top-up would silently undo moderation.
    if (Number(m.bond_usdc) < MIN_BOND && m.status === 'online') {
      await setMerchantStatus(m.id, 'suspended', 'bond');
      log?.(`merchant ${m.name} suspended (bond ${m.bond_usdc} < ${MIN_BOND})`);
    } else if (m.status === 'suspended' && Number(m.bond_usdc) >= MIN_BOND) {
      // Lands on 'offline' — solvent again is eligible-to-work, not back-at-the-desk. Before this,
      // an LP who topped up stayed suspended until an admin noticed, and the dev route only worked
      // on kyb_status='pending' rows, so there was effectively no way back at all.
      if (await reinstateBondSuspendedMerchant(m.id, MIN_BOND)) {
        log?.(`merchant ${m.name} reinstated to offline (bond ${m.bond_usdc} >= ${MIN_BOND})`);
      }
    }
  }
}
