// money.ts — money DISPLAY formatters shared by the clients. Nothing here is arithmetic on a value
// that will be stored or sent: printing is the one place an amount is allowed to become a `number`
// (see units.ts and docs/01-architecture.md § Money & decimals).
// Brand rule: the rupee symbol is ₹ (never "Rs"); every money figure is set in mono.

/** Offline fallback only. The live mid rate comes from the backend (`/fx/rate`, cached +
 *  range-validated); this is what the client is seeded with before the first fetch lands. */
export const RATE = 87.55;

// en-IN grouping (lakh/crore style). Hermes/Node ship Intl; fall back to a manual
// grouper if it is ever unavailable.
function groupIN(n: number): string {
  try {
    return new Intl.NumberFormat('en-IN').format(n);
  } catch {
    const s = Math.round(n).toString();
    const neg = s.startsWith('-');
    const digits = neg ? s.slice(1) : s;
    if (digits.length <= 3) return s;
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return (neg ? '-' : '') + rest + ',' + last3;
  }
}

/** An amount as it arrives from anywhere: the canonical decimal string of the wire DTOs, or a
 *  `number` from a view model. Widened here so the flip to strings costs one line, not sixteen. */
export type MoneyLike = string | number;

const num = (v: MoneyLike): number => (typeof v === 'string' ? Number(v) : v);

/** "1 USD = 95.25 INR" for the rate-locked line. Pass the live rate — the no-arg form falls back to
 *  the static one, which drifts (it was ~8 rupees off the live mid at the time of writing).
 *  Declared here, below `num`, because RATE_LABEL calls it at module-eval time. */
export const rateLabel = (rate: MoneyLike = RATE): string => `1 USD = ${num(rate).toFixed(2)} INR`;

/** @deprecated Use {@link rateLabel} with the live rate. Kept so the parked mobile app compiles. */
export const RATE_LABEL = rateLabel();

/** Rupees for a USD amount, rounded. Pass a live rate (M7) to override the static fallback `RATE`.
 *  e.g. inr(420) -> "₹36,771"; inr(420, 94.4) -> "₹39,648" */
export const inr = (usdAmount: MoneyLike, rate: MoneyLike = RATE): string =>
  '₹' + groupIN(Math.round(num(usdAmount) * num(rate)));

/** USD figure with 2 decimals. e.g. usd(5.71) -> "$5.71" */
export const usd = (n: MoneyLike): string => '$' + num(n).toFixed(2);

/** The currencies the app can display a USD balance in. */
export type DisplayCurrency = 'INR' | 'USD';

/** Format a USD amount in the user's chosen display currency. */
export const formatMoney = (usdAmount: MoneyLike, currency: DisplayCurrency): string =>
  currency === 'USD' ? usd(usdAmount) : inr(usdAmount);

/**
 * Format a raw rupee figure, keeping paise when there are any.
 *   inrRaw(500) -> "₹500"   ·   inrRaw(249.5) -> "₹249.50"   ·   inrRaw("500.00") -> "₹500"
 *
 * The paise half matters: a dynamic UPI QR can carry them, and rounding a ₹249.50 invoice to "₹250"
 * on screen while quoting something else is the kind of disagreement users notice. Whole amounts are
 * unchanged, so every existing caller renders byte-identically.
 */
export const inrRaw = (rupees: MoneyLike): string => {
  const [whole, paise] = num(rupees).toFixed(2).split('.');
  return '₹' + groupIN(Number(whole)) + (paise === '00' ? '' : '.' + paise);
};

/** USD needed to cover a rupee amount. */
export const rupeesToUsd = (rupees: MoneyLike): number => num(rupees) / RATE;
