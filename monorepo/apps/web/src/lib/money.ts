// Re-exports the shared money helpers so `@/lib/money` imports work. Source: @fpay/shared.
export { DISPLAY_CURRENCIES, FALLBACK_RATES, fiatFromUsd, fiatRaw, fiatSymbol, inr, inrRaw, isDisplayCurrency, RATE, rateLabel, RATE_LABEL, rupeesToUsd, usd } from '@fpay/shared';
export type { DisplayCurrency } from '@fpay/shared';
