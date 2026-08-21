// legs.ts — a payment made in parts, as the ONE order the payer sees. Pure (types + exact
// arithmetic only) so check-routing-math.ts can assert it with no database and no env.
import type { Order, OrderState } from '@fpay/shared';

import { amt, USDC_DECIMALS } from './amount';
import { BN, formatAmount } from './units';

const STATE_ORDER: OrderState[] = [
  'quote_locked',
  'pay_instructions',
  'waiting_payment',
  'payment_detected',
  'merchant_confirms',
  'funds_released',
  'completed',
];
const TERMINAL = new Set<OrderState>(['completed', 'refunded', 'failed']);

/**
 * `legs` is primary-first; a single-leg payment is returned as is.
 *
 * - state: the least-advanced live leg, so the timeline never runs ahead of the slowest part; once
 *   every leg has settled, `completed` if any part reached the receiver (a part that did not has
 *   its own refunded leg and its own notification), else `refunded`/`failed`.
 * - resolution: the first live leg's, so a banner shows while any part is escalating.
 * - payoutClaimedAt: only when EVERY part still in play has been claimed — the moment the receiver
 *   has all of it and the payer's dispute window is running on all of it.
 * - payoutUtr: none at the top — a reference is per credit, so each leg carries its own.
 * - amountUsdc / amountFiat: the whole payment, what the payer actually paid.
 */
export function aggregateLegs(legs: Order[]): Order {
  const primary = legs[0];
  if (legs.length < 2) return primary;
  const live = legs.filter((l) => !TERMINAL.has(l.state));
  const inPlay = legs.filter((l) => l.state !== 'refunded' && l.state !== 'failed');
  const state: OrderState = live.length
    ? live.reduce((s, l) => (STATE_ORDER.indexOf(l.state) < STATE_ORDER.indexOf(s) ? l.state : s), live[0].state)
    : legs.some((l) => l.state === 'completed')
      ? 'completed'
      : legs.some((l) => l.state === 'refunded')
        ? 'refunded'
        : 'failed';
  const claimed = inPlay.length > 0 && inPlay.every((l) => l.payoutClaimedAt);
  return {
    ...primary,
    state,
    resolution: live.find((l) => l.resolution)?.resolution ?? null,
    amountUsdc: formatAmount(
      legs.reduce((s, l) => s.plus(new BN(l.amountUsdc)), amt(0)),
      USDC_DECIMALS,
    ),
    amountFiat: primary.quote.amountInr,
    payoutClaimedAt: claimed ? [...inPlay.map((l) => l.payoutClaimedAt!)].sort().at(-1) : undefined,
    payoutUtr: undefined,
    legs,
  };
}
