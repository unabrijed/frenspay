import { BN, parseAmount } from '../../lib/units';

// Credits use numeric(24,6), wider than real-USDC numeric(20,6) after a 10x grant.
function credits(raw: string) {
  if (typeof raw !== 'string' || !/^\d+(\.\d{1,6})?$/.test(raw)) throw new Error('invalid_credits');
  const value = new BN(raw);
  if (value.gte('1000000000000000000')) throw new Error('invalid_credits');
  return value;
}

export function tier(profile: boolean, phone: boolean, x: boolean): number {
  return !profile ? 1 : !phone ? 2 : !x ? 5 : 10;
}

/** Highest attained tier and funding peak survive withdrawals/unlinking for this campaign. */
export function grant(
  peak: string,
  observed: string,
  oldMultiplier: number,
  currentTier: number,
  granted: string,
) {
  const nextPeak = BN.maximum(parseAmount(peak, 6), parseAmount(observed, 6));
  const multiplier = Math.max(oldMultiplier, currentTier);
  const entitlement = nextPeak.times(multiplier);
  const increment = BN.maximum(0, entitlement.minus(credits(granted)));
  return {
    peak: nextPeak.toFixed(6),
    multiplier,
    entitlement: entitlement.toFixed(6),
    increment: increment.toFixed(6),
  };
}

/** Reward-funded credits first. Practice-only spending never generates reward points. */
export function debit(reward: string, practice: string, cost: string) {
  const amount = credits(cost);
  const r = credits(reward),
    p = credits(practice);
  if (!amount.gt(0) || amount.gt(r.plus(p))) throw new Error('insufficient_credits');
  const usedReward = BN.minimum(r, amount),
    usedPractice = amount.minus(usedReward);
  return {
    rewardRemaining: r.minus(usedReward).toFixed(6),
    practiceRemaining: p.minus(usedPractice).toFixed(6),
    rewardUsed: usedReward.toFixed(6),
    practiceUsed: usedPractice.toFixed(6),
    points: usedReward.toFixed(6),
  };
}

export function quoteCredits(amountSgd: string, rate: string): string {
  const amount = parseAmount(amountSgd, 2),
    fx = parseAmount(rate, 6);
  if (!amount.gt(0) || !fx.gt(0)) throw new Error('invalid_amount');
  return amount.div(fx).decimalPlaces(6, BN.ROUND_UP).toFixed(6);
}
