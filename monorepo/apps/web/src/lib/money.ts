// Re-exports the shared money helpers so `@/lib/money` imports work. Source: @fpay/shared.
export { formatMoney, inr, inrRaw, RATE, RATE_LABEL, rupeesToUsd, usd } from '@fpay/shared';
export type { DisplayCurrency } from '@fpay/shared';
