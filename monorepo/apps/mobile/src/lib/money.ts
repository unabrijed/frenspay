// money.ts — re-exports the shared money helpers so existing `@/lib/money`
// imports across the app keep working. Source of truth: @fpay/shared.
export { inr, inrRaw, RATE, RATE_LABEL, rupeesToUsd, usd } from '@fpay/shared';
