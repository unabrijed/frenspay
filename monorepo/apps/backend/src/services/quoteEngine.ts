// quoteEngine.ts — computes a locked quote (rate + ETA + route quality), valid 45s.
// The mid-market FX rate is LIVE (getMidRate, cached + range-validated per currency); the LP's
// spread shaves the rate, then the platform's cut is a FLAT $0.001 added to the USDC owed
// (decided 2026-08-13, docs/05 — replaces the old PLATFORM_FEE_BPS percentage fold). There are NO
// fee line items — the user only ever sees the all-in conversion rate, which is DERIVED from the
// amounts (fee first, rate after) and is display-only; the stored amounts are what move money.
import type { OrderDirection, PayoutMethod, Quote, RouteQuality } from '@fpay/shared';

import { insertQuote } from '../db/queries';
import { amt, fiatDecimals, USDC_DECIMALS } from '../lib/amount';
import { BN, divUp, formatAmount, RATE_DECIMALS } from '../lib/units';

import { getMidRate } from './fxRate';
import { rankMerchants } from './routing';

const QUOTE_TTL_MS = 45_000; // the architecture's 45-second lock

// The platform's whole cut per conversion. Flat and hardcoded on purpose: the decided value is
// exact ($0.001, superlow by design), not environment-tunable — a value that never changes gets
// no knob. check-fees.ts asserts the column carries exactly this.
const PLATFORM_FEE_USDC = 0.001;

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
    /** Fiat currency of the amount/fees — derived from the RAIL at the route (lib/corridors.ts). */
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

  // Fee FIRST, rate DERIVED — the inversion that makes a flat fee expressible at all (a bps fold
  // can't say "$0.001": it rounds away at 4dp on a big order and balloons at the minimum).
  //
  // Rounding directions still agree with the old discipline: the LP rate rounds DOWN (less fiat
  // per USDC), the USDC owed rounds UP, so sub-cent dust always lands on the user-pays side and
  // the LP is never short. Exact arithmetic throughout.
  const lpRate = amt(mid).times(10_000 - merchant.spread_bps).div(10_000).dp(RATE_DECIMALS, BN.ROUND_DOWN);
  const lpUsdc = divUp(amountFiat, lpRate, USDC_DECIMALS); // what the LP is owed
  const platformFeeUsdc = amt(PLATFORM_FEE_USDC); // flat, exact — never derived from the rates
  const amountUsdc = lpUsdc.plus(platformFeeUsdc); // what the user pays
  // Display-only: the all-in rate the user sees, derived FROM the amounts and rounded DOWN so the
  // shown rate never flatters. Nothing downstream reads it for money math — the stored amounts
  // and platform_fee_usdc are authoritative (deposit split / refund / release all read the column).
  const rate = amountFiat.div(amountUsdc).dp(RATE_DECIMALS, BN.ROUND_DOWN);

  return insertQuote({
    userId,
    merchantId: merchant.id,
    direction: input.direction,
    currency: input.currency,
    amountInr: formatAmount(amountFiat, fdp),
    amountUsdc: formatAmount(amountUsdc, USDC_DECIMALS),
    rate: formatAmount(rate, RATE_DECIMALS),
    platformFeeUsdc: formatAmount(platformFeeUsdc, USDC_DECIMALS),
    // Recorded so the order can later be offered to the pool at this price: only LPs at or below
    // the spread this quote was struck at are eligible, which is what makes broadcasting safe
    // without ever repricing what the payer was promised.
    spreadBps: merchant.spread_bps,
    etaMinSecs: merchant.avg_completion_secs,
    etaMaxSecs: merchant.avg_completion_secs * 2,
    payoutMethod: input.payoutMethod,
    routeQuality: routeQuality(top.score),
    payoutDestination: input.payoutDestination,
    payoutName: input.payoutName,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
  });
}
