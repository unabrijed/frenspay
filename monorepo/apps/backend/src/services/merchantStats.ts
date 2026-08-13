// merchantStats.ts — M4 performance scoring. Recomputes each merchant's live signals
// (success_rate, avg_completion_secs, dispute_rate) from real order outcomes, smoothed toward the seed
// `base_*` priors so a low-volume LP isn't volatile, and auto-suspends any LP whose bond falls below
// MIN_BOND. M3 ranking reads the same columns, so routing self-corrects with no ranking-code change.
import {
  listAllMerchants,
  merchantCompletionStats,
  merchantDisputeStats,
  merchantFeedbackStats,
  merchantOutcomeCounts,
  reinstateBondSuspendedMerchant,
  setMerchantStatus,
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

/** Smooth an observed mean toward a prior with k pseudo-observations: (obs·n + prior·k)/(n + k). */
function smooth(obsMean: number, n: number, prior: number): number {
  if (n <= 0) return prior;
  return (obsMean * n + prior * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT);
}

/**
 * Performance tier from signals that already exist — no new measurement, no new column to keep in
 * step. Volume gates each rung because the smoothed rates start at their priors: without it a
 * brand-new LP with one lucky order would read as tier 3 and be handed 8× leverage.
 *
 * Deliberately a step function over plain thresholds rather than a score. An LP has to be able to
 * read this and know what to fix; "your composite fell to 0.71" is not something anyone can act on.
 */
function tierFor(m: { settled: number; successRate: number; disputeRate: number; avgCompletionSecs: number }): number {
  if (m.settled >= 50 && m.successRate >= 0.98 && m.disputeRate <= 0.01 && m.avgCompletionSecs <= 120) return 3;
  if (m.settled >= 10 && m.successRate >= 0.95 && m.disputeRate <= 0.03) return 2;
  return 1;
}

/** Recompute every merchant's live signals from history, and suspend any below the bond floor. */
export async function recomputeMerchantStats(log?: (m: string) => void): Promise<void> {
  const [merchants, outcomes, completion, disputes, feedback] = await Promise.all([
    listAllMerchants(),
    merchantOutcomeCounts(),
    merchantCompletionStats(),
    merchantDisputeStats(),
    merchantFeedbackStats(),
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
