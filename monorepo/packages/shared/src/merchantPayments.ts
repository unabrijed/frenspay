/** Payment execution is selected by the server; these fields are not a customer network menu. */
export interface PaymentCapabilities {
  version: string;
  merchantPay: boolean;
  cardFunding: boolean;
  funding: { chain: 'solana:mainnet'; asset: 'USDC' };
}
export type MerchantPaymentStatus = 'review' | 'signing' | 'processing' | 'completed' | 'failed' | 'expired';
export interface MerchantPayment {
  id: string;
  status: MerchantPaymentStatus;
  merchant: string;
  amount: string;
  currency: string;
  debitUsd: string;
  expiresAt: number;
  reviewToken: string;
  collectDataUrl?: string;
  transferId?: string;
}
export interface MerchantSigningActions {
  payment: MerchantPayment;
  transactions: string[];
}

/** Strict URL recognition, also used on the server. Never fetch a scanned arbitrary URL. */
export function merchantPaymentLink(input: string): string | null {
  let raw = input.trim();
  if (raw.length > 4096) return null;
  if (/^wc:/i.test(raw)) {
    const match = /[?&]pay=([^&#]+)(?:&|$)/.exec(raw);
    if (!match) return null;
    try {
      raw = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }
  if (/^pay_[A-Za-z0-9_-]{1,128}$/.test(raw)) return `https://pay.walletconnect.com/${raw}`;
  const url = /^https:\/\/((?:[a-z0-9-]+\.)*pay\.walletconnect\.com)(\/[^?#]*)?(?:\?([^#]*))?$/i.exec(raw);
  if (!url) return null;
  const path = url[2] || '/';
  let id = path.slice(1);
  if (path === '/') {
    const values = (url[3] || '').split('&').filter((p) => p.startsWith('pid='));
    if (values.length !== 1) return null;
    try {
      id = decodeURIComponent(values[0].slice(4));
    } catch {
      return null;
    }
  }
  if (!/^pay_[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  return `https://${url[1].toLowerCase()}/${id}`;
}
