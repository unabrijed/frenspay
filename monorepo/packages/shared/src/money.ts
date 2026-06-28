// money.ts — money math + formatters shared by the mobile app and the backend.
// Brand rule: the rupee symbol is ₹ (never "Rs"); every money figure is set in mono.

export const RATE = 87.55; // 1 USD = 87.55 INR — locked the moment you pay

export const RATE_LABEL = '1 USD = 87.55 INR';

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

/** Rupees for a USD amount, rounded. Pass a live rate (M7) to override the static fallback `RATE`.
 *  e.g. inr(420) -> "₹36,771"; inr(420, 94.4) -> "₹39,648" */
export const inr = (usdAmount: number, rate: number = RATE): string => '₹' + groupIN(Math.round(usdAmount * rate));

/** USD figure with 2 decimals. e.g. usd(5.71) -> "$5.71" */
export const usd = (n: number): string => '$' + n.toFixed(2);

/** The currencies the app can display a USD balance in. */
export type DisplayCurrency = 'INR' | 'USD';

/** Format a USD amount in the user's chosen display currency. */
export const formatMoney = (usdAmount: number, currency: DisplayCurrency): string =>
  currency === 'USD' ? usd(usdAmount) : inr(usdAmount);

/** Format a raw rupee figure. e.g. inrRaw(500) -> "₹500" */
export const inrRaw = (rupees: number): string => '₹' + groupIN(Math.round(rupees));

/** USD needed to cover a rupee amount. */
export const rupeesToUsd = (rupees: number): number => rupees / RATE;
