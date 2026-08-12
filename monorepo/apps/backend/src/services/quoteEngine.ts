// quoteEngine.ts — computes a locked quote (rate + ETA + route quality), valid 45s.
// M7: the mid-market FX rate is LIVE (getMidRate, cached + range-validated per currency); the
// merchant spread AND the platform's cut are applied on top. There are NO fee line items — the
// user only ever sees the all-in conversion rate (`amountUsdc = amountFiat / rate`); the platform's
// share is the difference between that and the LP's spread-only rate, collected at deposit.
import type { OrderDirection, PayoutMethod, Quote, RouteQuality } from '@fpay/shared';

import { config } from '../envConfig';
import { insertQuote } from '../db/queries';
import { amt, fiatDecimals, USDC_DECIMALS } from '../lib/amount';
import { BN, divUp, formatAmount, RATE_DECIMALS } from '../lib/units';

import { getMidRate } from './fxRate';
import { rankMerchants } from './routing';

const QUOTE_TTL_MS = 45_000; // the architecture's 45-second lock

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

  // Worse-than-mid rate for the user: the LP spread plus the platform's cut both shave
  // fiat-per-USDC, so they spend a little more USDC for the same fiat amount. The user sees only
  // the all-in `rate` (amountUsdc = amountFiat / rate) — never a fee line.
  //
  // Both directions are deliberate and they agree: rates round DOWN (less fiat per USDC) and the
  // USDC owed rounds UP, so a sub-cent remainder always lands on the user's side of the trade
  // rather than leaving the LP short. Exact arithmetic throughout — the old
  // `.toFixed(4)`/`.toFixed(6)` pair rounded half-up, which could hand back a cent nobody funded.
  const lpRate = amt(mid).times(10_000 - merchant.spread_bps).div(10_000).dp(RATE_DECIMALS, BN.ROUND_DOWN);
  const rate = amt(mid)
    .times(10_000 - merchant.spread_bps - config.platformFeeBps)
    .div(10_000)
    .dp(RATE_DECIMALS, BN.ROUND_DOWN);
  const amountUsdc = divUp(amountFiat, rate, USDC_DECIMALS);
  // The platform's cut in USDC: what the user owes at the all-in rate minus what the LP is owed at
  // their spread-only rate. Both legs round UP (user-owes direction), so the difference can only
  // land in the platform's favor by sub-cent dust; clamped ≥0 in case both rates collapse to equal.
  const platformFeeUsdc = BN.max(amountUsdc.minus(divUp(amountFiat, lpRate, USDC_DECIMALS)), 0);

  return insertQuote({
    userId,
    merchantId: merchant.id,
    direction: input.direction,
    currency: input.currency,
    amountInr: formatAmount(amountFiat, fdp),
    amountUsdc: formatAmount(amountUsdc, USDC_DECIMALS),
    rate: formatAmount(rate, RATE_DECIMALS),
    platformFeeUsdc: formatAmount(platformFeeUsdc, USDC_DECIMALS),
    etaMinSecs: merchant.avg_completion_secs,
    etaMaxSecs: merchant.avg_completion_secs * 2,
    payoutMethod: input.payoutMethod,
    routeQuality: routeQuality(top.score),
    payoutDestination: input.payoutDestination,
    payoutName: input.payoutName,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
  });
}
