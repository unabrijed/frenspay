// quoteEngine.ts — computes a locked quote (rate + fee + ETA + route quality), valid 45s.
// M1 FX source is the shared RATE constant (quoted, not live); the merchant spread is applied on
// top. Fees are itemized line items reflecting the spread, mirroring the doc's quote screen math
// (`You receive = amountInr / rate`, fees shown separately).
import type { OrderDirection, PayoutMethod, Quote, RouteQuality } from '@pay/shared';

import { insertQuote } from '../db/queries';

import { rankMerchants } from './routing';

// Mid-market FX source for M1 (mirrors @pay/shared money.ts RATE; quoted, not live). The backend
// consumes @pay/shared for types only, so this constant stays local rather than a runtime import.
const MID_RATE_INR_PER_USDC = 87.55;
const QUOTE_TTL_MS = 45_000; // the architecture's 45-second lock
const FLAT_FEE_INR = 40; // platform fee (illustrative for M1)
const NETWORK_FEE_INR = 8; // on-chain network fee (illustrative for M1)

// M3: route quality derives from the composite ranking score, not raw success_rate (internal field;
// no longer shown to users per the "just pay" UX).
function routeQuality(score: number): RouteQuality {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

export async function createQuote(
  userId: string,
  input: { direction: OrderDirection; amountInr: number; payoutMethod: PayoutMethod },
): Promise<Quote | { error: 'no_merchant' }> {
  // Rank on a provisional USDC amount (mid rate, no spread) for the float hard-filter; the winning
  // LP's spread then sets the final rate.
  const provisionalUsdc = input.amountInr / MID_RATE_INR_PER_USDC;
  const ranked = await rankMerchants({ payoutMethod: input.payoutMethod, amountUsdc: provisionalUsdc });
  const top = ranked[0];
  if (!top) return { error: 'no_merchant' };
  const merchant = top.merchant;

  // Worse-than-mid rate for the user: the spread shaves INR-per-USDC, so they spend a little more
  // USDC for the same fiat amount. (amountUsdc = amountInr / rate.)
  const rate = Number((MID_RATE_INR_PER_USDC * (1 - merchant.spread_bps / 10_000)).toFixed(4));
  const amountUsdc = Number((input.amountInr / rate).toFixed(6));

  return insertQuote({
    userId,
    merchantId: merchant.id,
    direction: input.direction,
    amountInr: input.amountInr,
    amountUsdc,
    rate,
    feeInr: FLAT_FEE_INR,
    networkFeeInr: NETWORK_FEE_INR,
    etaMinSecs: merchant.avg_completion_secs,
    etaMaxSecs: merchant.avg_completion_secs * 2,
    payoutMethod: input.payoutMethod,
    routeQuality: routeQuality(top.score),
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
  });
}
