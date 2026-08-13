// money.ts — money DISPLAY formatters shared by the clients. Nothing here is arithmetic on a value
// that will be stored or sent: printing is the one place an amount is allowed to become a `number`
// (see units.ts and docs/01-architecture.md § Money & decimals).
// Brand rule: the rupee symbol is ₹ (never "Rs"); every money figure is set in mono.
// Per-currency since the Indonesia corridor: each fiat formats in its own convention (en-IN
// lakh/crore for ₹; id-ID dot-thousands for Rp, whole-rupiah always).
import { FIAT_DECIMALS } from './units';

/** Offline fallback only. The live mid rates come from the backend (`/fx/rate`, cached +
 *  range-validated per currency); these seed the client before the first fetch lands. */
export const RATE = 87.55;
export const FALLBACK_RATES: Record<string, number> = { INR: RATE, IDR: 16_500 };

/** Symbol + grouping locale per display currency. An unknown currency falls back to its ISO code
 *  as the "symbol" — ugly beats wrong. */
const FIAT_STYLE: Record<string, { symbol: string; locale: string }> = {
  INR: { symbol: '₹', locale: 'en-IN' },
  IDR: { symbol: 'Rp', locale: 'id-ID' },
};

/** '₹' / 'Rp'. Exported so a layout that styles the symbol separately (the home hero) can strip
 *  exactly the right length instead of assuming one character. */
export const fiatSymbol = (currency: string): string => FIAT_STYLE[currency]?.symbol ?? currency + ' ';

/** Group a whole-number part in the currency's own locale. Intl ships everywhere we run; if it
 *  ever throws, ungrouped digits beat a hand-rolled wrong grouping. */
function group(currency: string, n: number): string {
  try {
    return new Intl.NumberFormat(FIAT_STYLE[currency]?.locale ?? 'en-US').format(n);
  } catch {
    return String(n);
  }
}

/** An amount as it arrives from anywhere: the canonical decimal string of the wire DTOs, or a
 *  `number` from a view model. Widened here so the flip to strings costs one line, not sixteen. */
export type MoneyLike = string | number;

const num = (v: MoneyLike): number => (typeof v === 'string' ? Number(v) : v);

/** "1 USD = 95.25 INR" / "1 USD = 17,862 IDR" for the rate-locked line. Pass the live rate — the
 *  no-arg form falls back to the static one, which drifts. Whole-unit currencies group instead of
 *  showing fake decimals. Declared here, below `num`, because RATE_LABEL calls it at module-eval time. */
export const rateLabel = (rate: MoneyLike = RATE, currency: string = 'INR'): string => {
  const dp = FIAT_DECIMALS[currency] ?? 2;
  const r = num(rate);
  return `1 USD = ${dp === 0 ? group(currency, Math.round(r)) : r.toFixed(2)} ${currency}`;
};

/** @deprecated Use {@link rateLabel} with the live rate. Kept so the parked mobile app compiles. */
export const RATE_LABEL = rateLabel();

/** Fiat for a USD amount at a live rate, rounded to the currency's own minor unit.
 *  e.g. fiatFromUsd(420, 'INR', 94.4) -> "₹39,648"; fiatFromUsd(5, 'IDR', 17862) -> "Rp89,310" */
export const fiatFromUsd = (usdAmount: MoneyLike, currency: string, rate: MoneyLike): string =>
  fiatRaw(num(usdAmount) * num(rate), currency);

/** Rupees for a USD amount, rounded — the INR shorthand of {@link fiatFromUsd}. */
export const inr = (usdAmount: MoneyLike, rate: MoneyLike = RATE): string =>
  '₹' + group('INR', Math.round(num(usdAmount) * num(rate)));

/** USD figure with 2 decimals. e.g. usd(5.71) -> "$5.71" */
export const usd = (n: MoneyLike): string => '$' + num(n).toFixed(2);

/**
 * The currencies the app can display a USD balance in: the balance's own currency, plus the
 * corridor currencies we hold a live mid rate for. Deliberately NOT every rail in rails.ts — a
 * currency with no rate can only be shown converted at a stale or invented one, which is worse
 * than showing dollars. Adding one here means adding it to the client's `fxRates` too.
 */
export const DISPLAY_CURRENCIES = ['USD', 'INR', 'IDR'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/** Narrow a currency code (e.g. one derived from a country) to something we can actually display.
 *  A rail exists for Thailand, so `currencyForCountry` will hand back 'THB' — this is what stops
 *  that reaching the store as a currency nothing can price. */
export const isDisplayCurrency = (code: string): code is DisplayCurrency =>
  (DISPLAY_CURRENCIES as readonly string[]).includes(code);

/**
 * The SECOND currency a balance should be written in, or null when there isn't one.
 *
 * Two steps, and the order matters. First pick the *other* currency: where they are, when we can
 * price it — otherwise dollars, which we can always show because the balance is already dollars.
 * Then drop it if it turns out to be what they're reading in anyway, because restating a figure
 * directly beneath itself is the redundancy this whole rule exists to avoid. Note that null now
 * means only "it would say the same thing twice" — an unpriceable local currency no longer
 * silently costs the second line, it falls back.
 *
 * Pure and here rather than inside the hook that calls it, because "how many currencies does this
 * person see" is the rule the whole balance display turns on, and a rule this branchy is worth
 * being able to assert on (see scripts/check-money.ts).
 */
export const secondaryCurrency = (
  preferred: string,
  local: string,
  rates: Record<string, number>,
): string | null => {
  const other = local && rates[local] ? local : 'USD';
  return other === preferred ? null : other;
};

/**
 * Format a raw fiat figure in its own currency, keeping fractional minor units only when present
 * (and only when the currency has any — IDR is whole-rupiah).
 *   fiatRaw(500, 'INR') -> "₹500"  ·  fiatRaw(249.5, 'INR') -> "₹249.50"
 *   fiatRaw('17900.00', 'IDR') -> "Rp17,900"-style in id-ID grouping ("Rp17.900")
 *
 * The fraction half matters: a dynamic QR can carry it, and rounding a ₹249.50 invoice to "₹250"
 * on screen while quoting something else is the kind of disagreement users notice. (The DB stores
 * every corridor at 2dp scale, so "17900.00" arriving for a 0dp currency is normal — formatting
 * per-currency here is exactly why.)
 */
export const fiatRaw = (amount: MoneyLike, currency: string = 'INR'): string => {
  const dp = FIAT_DECIMALS[currency] ?? 2;
  const [whole, frac] = num(amount).toFixed(dp).split('.');
  return fiatSymbol(currency) + group(currency, Number(whole)) + (frac && Number(frac) !== 0 ? '.' + frac : '');
};

/** Raw rupee figure — the INR shorthand of {@link fiatRaw}. inrRaw(249.5) -> "₹249.50". */
export const inrRaw = (rupees: MoneyLike): string => fiatRaw(rupees, 'INR');

/** USD needed to cover a rupee amount. */
export const rupeesToUsd = (rupees: MoneyLike): number => num(rupees) / RATE;
