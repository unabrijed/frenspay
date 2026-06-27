// notify.ts — M6 in-app notifications. Thin, best-effort helpers over insertNotification for the
// lifecycle events a user cares about (everyday-app inbox: "Neha sent you $5", "Payment sent"). Never
// throws — a notification must not fail a money-movement path. Real push/webhooks deferred to M7.
import { insertNotification } from '../db/queries';

const usd = (n: number) => `$${n.toFixed(2)}`;

async function notify(userId: string, kind: string, title: string, body?: string): Promise<void> {
  try {
    await insertNotification({ userId, kind, title, body });
  } catch {
    /* best-effort */
  }
}

export const notifyReceived = (userId: string, amountUsd: number, fromHandle: string) =>
  notify(userId, 'received', 'Money received', `${fromHandle} sent you ${usd(amountUsd)}`);

export const notifyPaymentSent = (userId: string, amountUsd: number) =>
  notify(userId, 'payment_sent', 'Payment sent', `${usd(amountUsd)} paid`);

export const notifyRefunded = (userId: string, amountUsd: number) =>
  notify(userId, 'refunded', 'Refunded', `${usd(amountUsd)} returned — you’re made whole`);

export const notifyRequestPaid = (userId: string, amountUsd: number, byHandle: string) =>
  notify(userId, 'request_paid', 'Request paid', `${byHandle} paid your ${usd(amountUsd)} request`);

export const notifyKycUpgraded = (userId: string, tier: number) =>
  notify(userId, 'kyc_upgraded', 'You’re verified', tier >= 2 ? 'You can now pay merchants.' : `Tier ${tier} unlocked.`);
