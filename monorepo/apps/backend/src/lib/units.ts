// units.ts — the money convention. An amount is a DECIMAL STRING at rest and on the wire, a
// BigNumber inside a calculation, a bigint of base units at the chain edge, and a `number` only at
// the moment it is printed. Full rationale: docs/01-architecture.md § Money & decimals.
//
// THIS FILE EXISTS TWICE — packages/shared/src/units.ts and apps/backend/src/lib/units.ts — and the
// two must stay byte-identical. The backend can only `import type` from @fpay/shared (raw-TS
// workspace + tsx), so it keeps a copy rather than an import. `yarn check:money` fails on drift.
import BigNumber from 'bignumber.js';

/**
 * Module-local constructor. Cloned, not configured, because `BigNumber.config()` is process-global
 * — any dependency that calls it would silently change our arithmetic. `EXPONENTIAL_AT: 1e9`
 * disables exponential notation entirely: `"1e-7"` is not a valid Postgres `numeric` literal and is
 * wrong on the wire. DECIMAL_PLACES is intermediate headroom only — every output is explicitly
 * `.dp()`'d by divUp/divDown, so nothing here depends on the default ROUNDING_MODE.
 */
export const BN = BigNumber.clone({
  EXPONENTIAL_AT: 1e9,
  DECIMAL_PLACES: 30,
  ROUNDING_MODE: BigNumber.ROUND_DOWN,
});

/** A money value mid-calculation. Never store or transmit one — format it first. */
export type Amount = BigNumber;

export const USDC_DECIMALS = 6; // USDC on Solana and on every EVM chain we support
export const RATE_DECIMALS = 4; // quoteEngine emits 4dp; quotes.rate is numeric(20,6) — wider on purpose

/**
 * Minor units per fiat currency fpay quotes in — decimals stay a parameter (docs/01), this is the
 * lookup, not a constant to bake in. IDR is 0 by practice, not ISO: sen hasn't circulated in
 * decades, and no keypad, rail, or PSP deals in fractional rupiah. Storage is unaffected — the DB
 * keeps numeric(20,2) scale for every corridor ("17900" stores as 17900.00); this governs
 * validation at the trust boundary, fee rounding, and display.
 */
export const FIAT_DECIMALS: Record<string, number> = { INR: 2, IDR: 0 };

/** fiatDecimals('INR') → 2. Throws on a currency we don't price — a typo must not become a quote. */
export function fiatDecimals(currency: string): number {
  const d = FIAT_DECIMALS[currency];
  if (d == null) throw new Error(`unknown fiat currency ${currency}`);
  return d;
}

/** numeric(20,6) holds 20 significant digits with 6 after the point, so 14 before it. */
const MAX_AMOUNT = new BN(10).pow(14);

// Plain decimal, unsigned. Deliberately strict: it is the single line that rejects exponent
// notation ("1e-9", "1e+308"), "NaN"/"Infinity" (which the BigNumber constructor would happily turn
// into a non-finite value instead of throwing), negatives, whitespace, "" and ".5".
const DECIMAL_RE = /^\d+(\.\d+)?$/;

/**
 * Decimal string → BigNumber. Throws on anything that isn't a plain unsigned decimal, on more
 * fraction digits than `decimals`, and on values the column can't hold. **Never rounds** — if a
 * caller sends 10dp we do not know which 6 they meant, so we refuse. (viem's parseUnits guesses.)
 */
export function parseAmount(raw: string, decimals: number): Amount {
  if (typeof raw !== 'string' || !DECIMAL_RE.test(raw)) {
    throw new Error(`invalid amount ${JSON.stringify(raw)} — expected a plain decimal string like "12.50"`);
  }
  const frac = raw.split('.')[1];
  if (frac && frac.length > decimals) {
    throw new Error(`invalid amount ${raw} — ${frac.length} decimal places, this asset has ${decimals}`);
  }
  const v = new BN(raw);
  if (v.gte(MAX_AMOUNT)) throw new Error(`amount ${raw} is too large to store`);
  return v;
}

/**
 * BigNumber → canonical fixed-dp string ("10" → "10.000000"), the exact inverse of parseAmount, so
 * string equality on amounts is meaningful. Always `.toFixed(dp)`, never `.toString()` — the latter
 * can emit exponential notation. Throws rather than round: reaching here with more precision than
 * the asset has means a division skipped divUp/divDown.
 */
export function formatAmount(v: Amount, decimals: number): string {
  if (!v.isFinite()) throw new Error(`invalid amount ${v.toFixed()} — division by zero, or arithmetic on a rejected value`);
  if ((v.dp() ?? 0) > decimals) {
    throw new Error(`refusing to format ${v.toFixed()} at ${decimals}dp — it would silently round; use divUp/divDown`);
  }
  return v.toFixed(decimals);
}

/**
 * The trust boundary. Takes whatever JSON handed us — string or (legacy) number — and returns a
 * canonical decimal string, or throws. **This is the only place a `number` may enter the money
 * path.** `String(n)` is the bridge, and it is deliberately allowed to produce "1e-9" / "1e+308" /
 * "NaN" so that parseAmount rejects them here rather than Postgres rejecting them as a 500.
 */
export function normalizeAmount(raw: unknown, decimals: number): string {
  const s = typeof raw === 'number' ? String(raw) : raw;
  return formatAmount(parseAmount(s as string, decimals), decimals);
}

/**
 * BigNumber → integer base units for the chain (SPL `u64`, ERC-20 `uint256`). `decimals` is always
 * passed in, never assumed: on Solana it comes from the mint itself (services/solana.ts), and it
 * varies by asset and ecosystem. A non-integer after the shift means excess precision got past a
 * boundary — refuse rather than round, because the chain is the last place to discover that.
 */
export function toBaseUnits(v: Amount, decimals: number): bigint {
  const shifted = v.shiftedBy(decimals);
  if (!shifted.isInteger()) {
    throw new Error(`${v.toFixed()} does not fit ${decimals} decimals — excess precision reached the chain edge`);
  }
  return BigInt(shifted.toFixed(0));
}

/** Integer base units from the chain → BigNumber. Exact at any scale, including 18dp. */
export function fromBaseUnits(base: bigint, decimals: number): Amount {
  return new BN(base.toString()).shiftedBy(-decimals);
}

// The rounding law: round so the platform is never short. What the user OWES rounds up; what fpay
// DELIVERS rounds down; a fee ceiling handed to a protocol rounds up (round it down and the CCTP
// burn reverts). Both directions are named functions so no call site leans on a default.

/** a / b at `decimals`, rounded UP — what the user owes, and any protocol fee ceiling. */
export function divUp(a: Amount, b: Amount, decimals: number): Amount {
  return a.div(b).dp(decimals, BN.ROUND_UP);
}

/** a / b at `decimals`, rounded DOWN — what fpay delivers. */
export function divDown(a: Amount, b: Amount, decimals: number): Amount {
  return a.div(b).dp(decimals, BN.ROUND_DOWN);
}
