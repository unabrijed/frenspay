// quoteEngine.ts — computes a locked quote (rate + fee + ETA + route quality), valid 45s.
// M7: the mid-market FX rate is LIVE (getMidRate, cached + range-validated per currency); the
// merchant spread is applied on top. Fees are itemized line items reflecting the spread, mirroring
// the doc's quote screen math (`You receive = amountFiat / rate`, fees shown separately).
import type { OrderDirection, PayoutMethod, Quote, RouteQuality } from '@fpay/shared';

import { insertQuote } from '../db/queries';
import { amt, fiatDecimals, USDC_DECIMALS } from '../lib/amount';
import { BN, divUp, formatAmount, RATE_DECIMALS } from '../lib/units';

import { getMidRate } from './fxRate';
import { rankMerchants } from './routing';

const QUOTE_TTL_MS = 45_000; // the architecture's 45-second lock
// Fees are USD-denominated and converted at the mid per corridor — the same design as the
// compliance tiers. Priced per-currency they'd silently set a different fee per corridor
// (₹40 ≈ $0.45, but Rp 40 ≈ $0.002). Illustrative for M1, like the INR literals they replace.
const FLAT_FEE_USD = 0.45; // platform fee
const NETWORK_FEE_USD = 0.09; // on-chain network fee

// M3: route quality derives from the composite ranking score, not raw success_rate (internal field;
// no longer shown to users per the "just pay" UX).
function routeQuality(score: number): RouteQuality {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

export async function createQuote(
  userId: string,
  input: {
    direction: OrderDirection;
    amountInr: number;
    /** Fiat currency of the amount/fees — derived from the RAIL at the route (lib/rails.ts). */
    currency: string;
    payoutMethod: PayoutMethod;
    /** WHO the merchant pays (validated per rail). `payoutMethod` is only the rail. */
    payoutDestination?: string;
    payoutName?: string;
  },
): Promise<Quote | { error: 'no_merchant' }> {
  // Rank on a provisional USDC amount (live mid rate, no spread) for the float hard-filter; the winning
  // LP's spread then sets the final rate. Capture the mid once so both legs use the same value.
  const mid = getMidRate(input.currency);
  const fdp = fiatDecimals(input.currency);
  const amountFiat = amt(input.amountInr);
  // money:number — the ranking float-filter only. rankMerchants compares available LP capacity and
  // scores it; it never moves money, so a sub-ulp difference can only shift an exact-boundary tie.
  const provisionalUsdc = input.amountInr / mid;
  const ranked = await rankMerchants({ payoutMethod: input.payoutMethod, amountUsdc: provisionalUsdc });
  const top = ranked[0];
  if (!top) return { error: 'no_merchant' };
  const merchant = top.merchant;

  // Worse-than-mid rate for the user: the spread shaves fiat-per-USDC, so they spend a little more
  // USDC for the same fiat amount. (amountUsdc = amountFiat / rate.)
  //
  // Both directions are deliberate and they agree: the rate rounds DOWN (less fiat per USDC) and
  // the USDC the user owes rounds UP, so a sub-cent remainder always lands on the user's side of the
  // trade rather than leaving the LP short. Exact arithmetic throughout — the old
  // `.toFixed(4)`/`.toFixed(6)` pair rounded half-up, which could hand back a cent nobody funded.
  // Fees the user owes round UP at the currency's own minor unit (IDR: whole rupiah).
  const rate = amt(mid).times(10_000 - merchant.spread_bps).div(10_000).dp(RATE_DECIMALS, BN.ROUND_DOWN);
  const amountUsdc = divUp(amountFiat, rate, USDC_DECIMALS);

  return insertQuote({
    userId,
    merchantId: merchant.id,
    direction: input.direction,
    currency: input.currency,
    amountInr: formatAmount(amountFiat, fdp),
    amountUsdc: formatAmount(amountUsdc, USDC_DECIMALS),
    rate: formatAmount(rate, RATE_DECIMALS),
    feeInr: formatAmount(amt(FLAT_FEE_USD).times(mid).dp(fdp, BN.ROUND_UP), fdp),
    networkFeeInr: formatAmount(amt(NETWORK_FEE_USD).times(mid).dp(fdp, BN.ROUND_UP), fdp),
    etaMinSecs: merchant.avg_completion_secs,
    etaMaxSecs: merchant.avg_completion_secs * 2,
    payoutMethod: input.payoutMethod,
    routeQuality: routeQuality(top.score),
    payoutDestination: input.payoutDestination,
    payoutName: input.payoutName,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
  });
}
