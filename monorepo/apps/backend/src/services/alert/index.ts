// alert/index.ts — reach an LP, by whatever means they've given us.
//
// Two deliveries per alert, on purpose and not as a fallback chain:
//   1. the in-app inbox, always — it is the durable record, it already polls, and it costs one row;
//   2. their chosen out-of-band channel, if any — the part that reaches a pocket.
// The inbox alone was the entire state of merchant notification before this: an LP found out about
// an order by happening to have /merchant open on an 8s poll.
import { insertNotification, type MerchantRow } from '../../db/queries';
import { config } from '../../envConfig';

import type { AlertMessage, AlertProvider } from './provider';
import { telegramProvider } from './telegram';

/** Config-selected registry, same shape as the payout and KYC seams. Adding FCM/APNs when the
 *  mobile app comes back is a new file and one line here — nothing else changes. */
const PROVIDERS: Record<string, AlertProvider> = {
  [telegramProvider.id]: telegramProvider,
};

/** Deep-link target for the button in an alert — the LP console (provider.frenspay.xyz), not the
 *  payer app: the old webBaseUrl links pointed at /merchant/... routes that only ever existed
 *  there, so the button 404'd for as long as nobody could receive one. Unset → no button. */
const link = (path: string): string | undefined =>
  config.lpBaseUrl ? `${config.lpBaseUrl.replace(/\/$/, '')}${path}` : undefined;

/**
 * Alert the human behind an LP row. Best-effort throughout: an unreachable LP is a routing problem
 * (the escalation ladder already handles silence), never a failed order.
 *
 * A platform settlement row has no human — `user_id` is NULL by design — so there is nobody to tell
 * and this is a no-op for it.
 */
export async function alertMerchant(merchant: MerchantRow, msg: AlertMessage): Promise<void> {
  if (merchant.user_id) {
    try {
      await insertNotification({
        userId: merchant.user_id,
        kind: 'merchant_order',
        title: msg.title,
        body: msg.body,
      });
    } catch {
      /* best-effort — the inbox is a convenience, not a gate */
    }
  }
  const provider = merchant.alert_channel ? PROVIDERS[merchant.alert_channel] : undefined;
  if (provider && merchant.alert_address) await provider.send(merchant.alert_address, msg);
}

/** An order is funded and this LP can take it. Deliberately says the amount and NOT the payee:
 *  the whole point of the lock is that nobody learns who to pay until they've committed to it, and
 *  an alert that leaked the VPA would walk straight around it. */
export const alertOrderReady = (merchant: MerchantRow, amountFiat: string, currency: string, orderId: string) =>
  alertMerchant(merchant, {
    title: `${currency} ${amountFiat} to pay out`,
    body: 'Yours for the next few seconds, then it opens to everyone.',
    url: link(`/orders/${orderId}`),
  });

/** Sent while the payer is still signing, so the LP is already looking when the money lands. */
export const alertOrderIncoming = (merchant: MerchantRow, amountFiat: string, currency: string) =>
  alertMerchant(merchant, {
    title: `${currency} ${amountFiat} coming your way`,
    body: 'Funding now. Open the app so you don’t lose it to someone else.',
    url: link('/'),
  });

export const alertLockLost = (merchant: MerchantRow, reference: string) =>
  alertMerchant(merchant, {
    title: 'You lost an order',
    body: `${reference} went back to the pool because it wasn’t paid in time.`,
    url: link('/'),
  });
