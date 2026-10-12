import type { MerchantPayment, MerchantSigningActions, PaymentCapabilities } from '@fpay/shared';
import { req } from './api';
import { getActiveSigner } from './signer';
import { platform } from '../platform';

async function paymentRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    return await req<T>(path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const merchantApi = {
  capabilities: () => paymentRequest<PaymentCapabilities>('/payments/capabilities'),
  prepare: (paymentLink: string) =>
    paymentRequest<MerchantPayment>('/merchant-payments/prepare', {
      method: 'POST',
      body: JSON.stringify({ paymentLink }),
    }),
  list: () => paymentRequest<{ payments: MerchantPayment[] }>('/merchant-payments'),
  get: (id: string) => paymentRequest<MerchantPayment>(`/merchant-payments/${encodeURIComponent(id)}`),
  actions: (id: string, reviewToken: string) =>
    paymentRequest<MerchantSigningActions>(`/merchant-payments/${encodeURIComponent(id)}/actions`, {
      method: 'POST',
      body: JSON.stringify({ reviewToken }),
    }),
  confirm: (id: string, transactions: string[]) =>
    paymentRequest<MerchantPayment>(`/merchant-payments/${encodeURIComponent(id)}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ transactions }),
    }),
};
export interface PaymentBridge {
  fund(address: string, amount: string): Promise<void>;
  collect(url: string): Promise<void>;
}
let bridge: PaymentBridge | null = null;
export function setPaymentBridge(value: PaymentBridge | null) {
  bridge = value;
}
export function getPaymentBridge() {
  return bridge;
}
export async function payMerchant(payment: MerchantPayment): Promise<MerchantPayment> {
  const signer = getActiveSigner();
  if (!signer.signTransaction || !bridge) throw new Error('sponsorship_unsupported');
  const wallet = await signer.publicKey();
  const key = `fpay:merchant:${wallet}:${payment.id}`;
  const saved = await platform().storage.getItem(key);
  if (saved) {
    const attempt = JSON.parse(saved) as { transactions?: string[] };
    if (attempt.transactions) {
      const result = await merchantApi.confirm(payment.id, attempt.transactions);
      try {
        await platform().storage.removeItem(key);
      } catch {
        /* server owns recovery now */
      }
      return result;
    }
  }
  if (payment.collectDataUrl) await bridge.collect(payment.collectDataUrl);
  // No signing until recovery metadata is durable. This contains no private keys or card data.
  await platform().storage.setItem(key, JSON.stringify({ paymentId: payment.id }));
  const actions = await merchantApi.actions(payment.id, payment.reviewToken);
  const transactions = [];
  for (const raw of actions.transactions) transactions.push(await signer.signTransaction(raw));
  // Persist before sending; if storage is full, still hand the signature to the durable server.
  try {
    await platform().storage.setItem(key, JSON.stringify({ paymentId: payment.id, transactions }));
  } catch {
    /* still submit to durable server */
  }
  const result = await merchantApi.confirm(payment.id, transactions);
  try {
    await platform().storage.removeItem(key);
  } catch {
    /* server owns recovery now */
  }
  return result;
}
