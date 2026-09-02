// split.ts — the one rule a bill split must hold: the friends' parts never exceed the bill. Pure
// (BigNumber over canonical strings, no I/O) so check-split.ts can assert it without a database.
// The route resolves handles and writes rows; replaceShares holds the lock; this decides only the
// arithmetic. The payer's own part is what is left — it is never a stored number (docs/04).
import { BN, normalizeAmount, USDC_DECIMALS } from './units';

export type SharesVerdict =
  | { ok: true; amounts: string[] }
  | { ok: false; error: 'invalid_amount' | 'shares_exceed_amount' };

/**
 * `amountUsdc` is the expense; `paidSum` is Σ shares already settled on it (kept across a re-split);
 * `shares` are the new open ones as the client sent them. Each must be a positive amount the
 * asset can represent; together with the paid ones they may equal the bill but never exceed it.
 */
export function validateShares(amountUsdc: string, paidSum: string, shares: { amountUsd: unknown }[]): SharesVerdict {
  const amounts: string[] = [];
  let sum = new BN(paidSum);
  for (const s of shares) {
    let a: string;
    try {
      a = normalizeAmount(s.amountUsd, USDC_DECIMALS);
    } catch {
      return { ok: false, error: 'invalid_amount' };
    }
    if (!new BN(a).gt(0)) return { ok: false, error: 'invalid_amount' };
    amounts.push(a);
    sum = sum.plus(a);
  }
  if (sum.gt(amountUsdc)) return { ok: false, error: 'shares_exceed_amount' };
  return { ok: true, amounts };
}
