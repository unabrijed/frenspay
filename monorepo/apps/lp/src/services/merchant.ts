// merchant.ts — every LP-facing call. This file used to live in the payer app with a header
// explaining why it stayed out of the payer's store; it now lives in the app it always described.
import type {
  MerchantLedgerResponse,
  MerchantOrder,
  MerchantOrdersResponse,
  MerchantStakeClaimsResponse,
  PayoutMethod,
  PrepareTransferResponse,
} from '@fpay/shared';

import { ApiError, req } from './api';
import { getActiveSigner } from './signer';

export async function applyAsMerchant(input: {
  name: string;
  payoutMethod: PayoutMethod;
  treasuryAddress: string;
  contactPhone: string;
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

/**
 * Submit (or resubmit) the business details. Validated client-side first purely to save a round
 * trip on a typo — the server runs the same rules and is the only one that decides.
 */
export async function submitMerchantKyb(fields: Record<string, string>): Promise<void> {
  await req<{ ok: true; kybStatus: string }>('/merchants/kyb', {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
}

/** What settled to this LP, and every dispute raised against them. */
export async function getMerchantLedger(days = 30): Promise<MerchantLedgerResponse> {
  return req<MerchantLedgerResponse>(`/merchants/ledger?days=${days}`);
}

/** Where to reach this LP when work lands — the in-app inbox always fires, this is the pocket. */
export async function setMerchantAlerts(channel: string, address: string): Promise<void> {
  await req<{ ok: true }>('/merchants/alerts', { method: 'POST', body: JSON.stringify({ channel, address }) });
}

/** The number we call when a payout goes wrong. Separate from apply, which refuses an existing
 *  provider — so this is the only way anyone who onboarded earlier ever sets one. */
export async function setContactPhone(phone: string): Promise<{ contactPhone: string }> {
  return req<{ ok: true; contactPhone: string }>('/merchants/contact-phone', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
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
 * `payoutAddress` is where it goes: any Solana wallet the partner holds; null = their fpay wallet.
 */
export async function requestStakeWithdrawal(amountUsd: number, payoutAddress: string | null = null): Promise<{ id: string }> {
  return req<{ id: string; amountUsdc: string }>('/merchants/stake/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amountUsd, payoutAddress: payoutAddress ?? undefined }),
  });
}

export async function cancelStakeWithdrawal(id: string): Promise<void> {
  await req<{ ok: true }>(`/merchants/stake/withdraw/${id}/cancel`, { method: 'POST' });
}

/** Change where an OPEN request goes. Exists because leaving cannot be cancelled — a typo in that
 *  address would otherwise be a support ticket. */
export async function setWithdrawalAddress(id: string, payoutAddress: string | null): Promise<void> {
  await req<{ ok: true }>(`/merchants/stake/withdraw/${id}/address`, {
    method: 'POST',
    body: JSON.stringify({ payoutAddress: payoutAddress ?? undefined }),
  });
}

/** Where to pay, and every claim this partner has made (docs/19). `address` null = staking is not
 *  configured on this tier; the screen says so rather than offering a button that 503s. */
export async function getStakeClaims(): Promise<MerchantStakeClaimsResponse> {
  return req<MerchantStakeClaimsResponse>('/merchants/stake/claims');
}

/**
 * "This transaction is my stake." The server reads it off the chain — amount, sender, memo — and a
 * person attributes it; the bond lands only after the confirmer's own chain check. Nothing is typed
 * but the signature, so nothing can be mistyped into a burned deposit.
 */
export async function submitStakeClaim(signature: string): Promise<void> {
  await req<{ id: string; status: string }>('/merchants/stake/claims', {
    method: 'POST',
    body: JSON.stringify({ signature }),
  });
}

/**
 * Leave fpay as a partner: the whole stake becomes one withdrawal, sent by hand like any other,
 * and the account is marked as left — never deleted, and not reversible from here.
 */
export async function exitMerchant(payoutAddress: string | null = null): Promise<{ withdrawalId: string | null }> {
  return req<{ ok: true; withdrawalId: string | null }>('/merchants/exit', {
    method: 'POST',
    body: JSON.stringify({ payoutAddress: payoutAddress ?? undefined }),
  });
}

/**
 * Stake USDC as a bond. Same prepare → sign → submit shape as every other money movement: the server
 * builds a fee-payer-sponsored transfer to the stake vault, the merchant's own wallet signs it, and
 * the EXISTING /transfer/submit records the signature. The bond is credited when it confirms — which
 * is why this returns after submit rather than pretending the stake is live.
 */
export async function depositStake(amountUsd: number): Promise<'sent' | 'claimed'> {
  const prep = await req<PrepareTransferResponse>('/merchants/stake/prepare', {
    method: 'POST',
    body: JSON.stringify({ amountUsd }),
  });
  const signature = await getActiveSigner().signAndSend(prep.unsignedTx, { sponsored: prep.sponsored });
  // The same /transfer/submit every money movement uses — it is scoped to from_user_id, so it
  // accepts any transfer the caller owns. This console needs exactly this one call from it, so it
  // is written out rather than dragging the payer app's 40-method client across.
  try {
    await req<{ ok: true }>('/transfer/submit', {
      method: 'POST',
      body: JSON.stringify({ transferId: prep.transferId, signature }),
    });
    return 'sent';
  } catch (e) {
    // The prepared row was swept while the wallet sat on the approval screen (unsigned rows expire
    // after 15 minutes) — but the USDC moved. Hand the signature to the claim path instead of losing
    // it: same deposit, a person attributes it (docs/19). Before this it landed nowhere.
    if (e instanceof ApiError && e.code === 'transfer_not_found') {
      await submitStakeClaim(signature);
      return 'claimed';
    }
    throw e;
  }
}
