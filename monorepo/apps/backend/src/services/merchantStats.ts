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
  setMerchantStatus,
  updateMerchantStats,
} from '../db/queries';

const PRIOR_WEIGHT = 10; // k: pseudo-count of the seed prior (Bayesian smoothing)
const POSITIVE_PRIOR = 0.9; // payer-👍 prior — a code constant, unlike the per-merchant base_* seeds
export const MIN_BOND = 2000; // below this, an LP is suspended (out of routing)
export const DISPUTE_PENALTY_USDC = 1500; // flat bond fine drawn per upheld dispute

/** Smooth an observed mean toward a prior with k pseudo-observations: (obs·n + prior·k)/(n + k). */
function smooth(obsMean: number, n: number, prior: number): number {
  if (n <= 0) return prior;
  return (obsMean * n + prior * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT);
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

    await updateMerchantStats(m.id, { successRate, avgCompletionSecs, disputeRate, positiveRate });

    // Bond enforcement (one-way): an online LP whose bond fell below the floor is suspended out of
    // routing. Reinstatement is manual (dev /sim/merchants/:id/kyb or a status endpoint).
    if (Number(m.bond_usdc) < MIN_BOND && m.status === 'online') {
      await setMerchantStatus(m.id, 'suspended');
      log?.(`merchant ${m.name} suspended (bond ${m.bond_usdc} < ${MIN_BOND})`);
    }
  }
}
