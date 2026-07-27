// merchant.ts — the merchant/LP side of the API. Kept out of usePayStore on purpose: this is a
// different person doing a different job (settling other people's payouts), and none of it belongs
// in the payer's screen state.
import type {
  MerchantOrder,
  MerchantOrdersResponse,
  PayoutMethod,
  PrepareTransferResponse,
} from '@fpay/shared';

import { api, req } from './api';
import { getActiveSigner } from './signer';

export async function applyAsMerchant(input: {
  name: string;
  payoutMethod: PayoutMethod;
  treasuryAddress: string;
}): Promise<{ id: string }> {
  return req<{ id: string; kybStatus: string }>('/merchants/apply', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getMerchantOrders(): Promise<MerchantOrder[]> {
  const res = await req<MerchantOrdersResponse>('/merchants/orders');
  return res.orders;
}

/** Report that the fiat leg was paid out-of-band. Starts the payer's dispute window. */
export async function markOrderPaid(orderId: string, reference: string): Promise<{ releasesInSecs: number }> {
  return req<{ ok: true; releasesInSecs: number }>(`/merchants/orders/${orderId}/paid`, {
    method: 'POST',
    body: JSON.stringify({ reference }),
  });
}

export async function setMerchantFloat(floatUsd: number): Promise<void> {
  await req<{ ok: true }>('/merchants/float', { method: 'POST', body: JSON.stringify({ floatUsd }) });
}

/**
 * Stake USDC as a bond. Same prepare → sign → submit shape as every other money movement: the server
 * builds a fee-payer-sponsored transfer to the stake vault, the merchant's own wallet signs it, and
 * the EXISTING /transfer/submit records the signature. The bond is credited when it confirms — which
 * is why this returns after submit rather than pretending the stake is live.
 */
export async function depositStake(amountUsd: number): Promise<void> {
  const prep = await req<PrepareTransferResponse>('/merchants/stake/prepare', {
    method: 'POST',
    body: JSON.stringify({ amountUsd }),
  });
  const signature = await getActiveSigner().signAndSend(prep.unsignedTx);
  await api.submitTransfer({ transferId: prep.transferId, signature });
}
