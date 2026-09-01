// nextStep — what the dashboard puts in front of a partner who cannot take orders yet. Its own module
// so `check:next` can assert the ORDER, which is the part that regresses quietly: suspended must win
// before the stake check (an exited partner has a zero bond), and the business check must come
// before the stake (a human has to read it; the stake is instant).
import type { MerchantProfile } from '@fpay/shared';
import { kybAwaitingMerchant, usd } from '@fpay/shared';

import { KYB_COPY } from './kybCopy';

export type NextStep = { title: string; body: string; cta?: string; href?: string };

/**
 * The first thing standing between this partner and an order, in the order it should be done: the
 * business check first because a human has to read it, the stake while that happens, then the
 * switch. Null when there is nothing to do (online) or the Taking-orders row already explains
 * (suspended — an exited partner has a zero bond and must not be asked to stake again).
 */
export function nextStep(m: MerchantProfile): NextStep | null {
  if (m.status === 'suspended') return null;
  if (kybAwaitingMerchant(m.kybStatus)) {
    const copy = KYB_COPY[m.kybStatus];
    // A more-info request is the reviewer's own words when we have them — that is the actionable part.
    const body = m.kybStatus === 'more_info' ? (m.kybNote ?? 'Update what we’ve asked for and send it again.') : copy.body;
    return { title: copy.title, body, cta: 'Add details', href: '/business' };
  }
  if (Number(m.bondUsdc) < Number(m.minBondUsdc)) {
    return {
      title: 'Put up your stake',
      body: `At least ${usd(m.minBondUsdc)}. It backs the payouts you take, and comes back when you leave.`,
      cta: 'Add stake',
      href: '/stake',
    };
  }
  if (m.kybStatus !== 'approved') {
    return {
      title: KYB_COPY[m.kybStatus]?.title ?? m.kybStatus,
      body: m.kybStatus === 'rejected' ? (m.kybNote ?? KYB_COPY.rejected.body) : 'Nothing to do — we turn on orders as soon as it’s approved.',
    };
  }
  if (m.status === 'offline') {
    return { title: 'You’re ready', body: 'Turn on taking orders and work will start reaching you.', cta: 'Go online' };
  }
  return null;
}
