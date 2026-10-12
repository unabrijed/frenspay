import type { PaymentCapabilities } from '@fpay/shared';
import { config } from '../envConfig';

export const SOLANA_PAY_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const PAYMENT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export function paymentCapabilities(userId: string): PaymentCapabilities {
  const supported = config.paymentChain === 'solana' && config.usdcMint === PAYMENT_USDC_MINT;
  const eligible =
    supported &&
    config.paymentPilotUsers
      .split(',')
      .map((v) => v.trim())
      .includes(userId);
  return {
    version: config.paymentPolicyVersion,
    merchantPay: eligible && config.merchantPayEnabled && Boolean(config.wcpProjectId),
    cardFunding: eligible && config.cardFundingEnabled,
    funding: { chain: 'solana:mainnet', asset: 'USDC' },
  };
}
export function paymentError(code: string, statusCode = 409): Error & { statusCode: number } {
  return Object.assign(new Error(code), { statusCode });
}
export function requireMerchantPay(userId: string) {
  if (!paymentCapabilities(userId).merchantPay) throw paymentError('merchant_pay_unavailable', 503);
}
export function trustedCollectionUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const url = new URL(raw);
  const hosts = config.paymentCollectHosts
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.includes(url.hostname.toLowerCase())
  ) {
    throw paymentError('payment_information_unavailable', 503);
  }
  return url.href;
}
