// split.ts — how a bill divides equally among n people (docs/04 §Trips). Client-side arithmetic:
// the server only ever checks that the friends' parts fit inside the bill (backend lib/split.ts).
//
// Cents, not micro-dollars: a friend is asked for $33.33, not $33.333333, because that is what
// people say across a table. Everyone but the payer rounds DOWN and the payer keeps the remainder
// — the one direction that can never make the parts exceed the bill. Kept out of units.ts, which
// is byte-mirrored into the backend (invariant 4) and must not grow client-only code.
import { BN, divDown, formatAmount, parseAmount, USDC_DECIMALS } from './units';

export const SPLIT_DECIMALS = 2;

/**
 * `n` shares of `totalUsd`; index 0 is the payer's (the remainder), the rest are equal. Throws on
 * a non-positive count or an unparseable total — both are client bugs, not user input.
 */
export function splitEqual(totalUsd: string, n: number): string[] {
  if (!Number.isInteger(n) || n < 1) throw new Error('splitEqual: n must be a positive integer');
  const total = parseAmount(totalUsd, USDC_DECIMALS);
  const each = divDown(total, new BN(n), SPLIT_DECIMALS);
  const payer = total.minus(each.times(n - 1));
  return [formatAmount(payer, SPLIT_DECIMALS), ...Array.from({ length: n - 1 }, () => formatAmount(each, SPLIT_DECIMALS))];
}
