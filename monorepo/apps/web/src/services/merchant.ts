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

/**
 * Take an order, and learn who to pay in the same call.
 *
 * Exactly one caller wins — the server's lock is a single guarded UPDATE — and the payee comes back
 * only on the winning response. There is deliberately no separate "fetch the payee" call: if the
 * reveal were its own request, a lock could succeed while the reveal failed, leaving an LP holding
 * an order they can't see how to pay.
 */
export async function lockOrder(orderId: string): Promise<{ payoutDestination?: string; expiresInSecs: number }> {
  return req<{ ok: true; payoutDestination?: string; payoutName?: string; expiresInSecs: number }>(
    `/merchants/orders/${orderId}/lock`,
    { method: 'POST' },
  );
}

/** Hand it back before the timer runs out. Free, on purpose. */
export async function unlockOrder(orderId: string): Promise<void> {
  await req<{ ok: true }>(`/merchants/orders/${orderId}/unlock`, { method: 'POST' });
}

/** Where to reach this LP when work lands — the in-app inbox always fires, this is the pocket. */
export async function setMerchantAlerts(channel: string, address: string): Promise<void> {
  await req<{ ok: true }>('/merchants/alerts', { method: 'POST', body: JSON.stringify({ channel, address }) });
}

/** Report that the fiat leg was paid out-of-band. Starts the payer's dispute window. */
export async function markOrderPaid(orderId: string, reference: string): Promise<{ releasesInSecs: number }> {
  return req<{ ok: true; releasesInSecs: number }>(`/merchants/orders/${orderId}/paid`, {
    method: 'POST',
    body: JSON.stringify({ reference }),
  });
}

/** Declare in-flight capacity. Routing takes min(this, stake × leverage), so asking for more than
 *  the stake backs changes nothing — MerchantProfile.maxFloatUsdc is what it's actually worth. */
export async function setMerchantFloat(floatUsd: number): Promise<void> {
  await req<{ ok: true }>('/merchants/float', { method: 'POST', body: JSON.stringify({ floatUsd }) });
}

/** Go online / offline. The honest version of what people were doing by setting capacity to zero. */
export async function setMerchantOnline(online: boolean): Promise<void> {
  await req<{ ok: true }>('/merchants/status', { method: 'POST', body: JSON.stringify({ online }) });
}

/** The LP's own take off the mid rate, in basis points. Their only price lever. */
export async function setMerchantSpread(spreadBps: number): Promise<void> {
  await req<{ ok: true }>('/merchants/spread', { method: 'POST', body: JSON.stringify({ spreadBps }) });
}

/**
 * Ask for stake back. Debits the bond immediately and records a request — the USDC itself is sent by
 * hand, because the stake vault has no signer by design. Refused while anything is still in flight.
 */
export async function requestStakeWithdrawal(amountUsd: number): Promise<{ id: string }> {
  return req<{ id: string; amountUsdc: string }>('/merchants/stake/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amountUsd }),
  });
}

export async function cancelStakeWithdrawal(id: string): Promise<void> {
  await req<{ ok: true }>(`/merchants/stake/withdraw/${id}/cancel`, { method: 'POST' });
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
