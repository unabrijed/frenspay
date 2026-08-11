// amount.ts — the HTTP-side wrapper over units.ts: turn whatever a client sent into a validated
// amount, or null so the route can answer 400 invalid_amount.
//
// Kept OUT of lib/units.ts on purpose — that file is the byte-identical mirror of
// packages/shared/src/units.ts (check:money enforces it) and must not grow backend-only code.
//
// What this rejects that the old `!amount || amount <= 0` did not: more decimal places than the
// asset has (silently truncated to 6 before), exponent notation, NaN/Infinity, and anything too
// large for numeric(20,6) — which used to surface as a Postgres 22003, i.e. a 500.
import { type Amount, BN, fiatDecimals, formatAmount, normalizeAmount, USDC_DECIMALS } from './units';

export { fiatDecimals, USDC_DECIMALS };

/**
 * An amount the system can represent exactly, or null. Zero is allowed — use for balances and
 * capacities that legitimately reach it (a drained float, a waived fee).
 *
 * ponytail: returns a `number` because the wire DTOs still say `number`. The canonical string from
 * normalizeAmount is the durable form; this wrapper collapses to it when contracts.ts flips.
 */
export function nonNegativeAmount(raw: unknown, decimals: number = USDC_DECIMALS): number | null {
  try {
    return Number(normalizeAmount(raw, decimals));
  } catch {
    return null;
  }
}

/** As above, but zero is not money movement — use for anything that debits, credits, or prices. */
export function positiveAmount(raw: unknown, decimals: number = USDC_DECIMALS): number | null {
  const n = nonNegativeAmount(raw, decimals);
  return n !== null && n > 0 ? n : null;
}

// --- the arithmetic seam ---------------------------------------------------------------------
// Fee math runs exact in the middle and rounds ONCE at the edge, in a direction with a name. These
// three replace the four hand-rolled `Math.round(x * 100) / 100` copies that used to do it half-up
// wherever someone happened to write one.
//
// Default to USDC's own 6dp, not cents. A rail fee is a USDC amount in a numeric(20,6) column —
// quantizing it to 2dp both under-collected (a $1 fast transfer owed Circle $0.0001 and collected
// $0.00) and, rounded the other way, would over-charge that same transfer 100x. Pass `2` only where
// something genuinely settles in cents.
//
// ponytail: they take and return wire `number`s because contracts.ts still does. When it flips,
// amt()/roundUp()/roundDown() collapse into parseAmount/formatAmount and this block goes away.

/** Wire `number` → exact value. Every amount reaching here already passed positiveAmount(). */
export const amt = (n: number): Amount => new BN(n);

/** Exact value → wire `number`, rounded UP — what the user owes, and any fee ceiling handed to a
 *  protocol (round a CCTP maxFee down and the burn reverts on-chain). */
export const roundUp = (v: Amount, decimals: number = USDC_DECIMALS): number =>
  Number(formatAmount(v.dp(decimals, BN.ROUND_UP), decimals));

/** Exact value → wire `number`, rounded DOWN — what fpay delivers. */
export const roundDown = (v: Amount, decimals: number = USDC_DECIMALS): number =>
  Number(formatAmount(v.dp(decimals, BN.ROUND_DOWN), decimals));

/** → the canonical decimal string a response DTO carries. Strict on purpose: it THROWS rather than
 *  round, because reaching a response with more precision than the asset has means a rounding
 *  decision was skipped somewhere upstream, and this is the wrong place to guess which way. */
export const usdStr = (v: Amount | number, decimals: number = USDC_DECIMALS): string =>
  formatAmount(typeof v === 'number' ? amt(v) : v, decimals);
