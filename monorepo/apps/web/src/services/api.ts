// api.ts — typed fetch client for the Railway backend. Same @fpay/shared DTOs as the server.
import type {
  ApiPaymentRequest,
  AuthSyncRequest,
  BalanceResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  CreateRequestRequest,
  CrosschainQuoteResponse,
  DepositBalancesResponse,
  DepositInfoResponse,
  DepositPrepareRequest,
  DepositPrepareResponse,
  PrepareCrosschainRequest,
  PrepareCrosschainResponse,
  ReportDepositRequest,
  ReportDepositResponse,
  SubmitCrosschainRequest,
  FaucetRequest,
  FaucetResponse,
  FundSubmitRequest,
  KycVerifyResponse,
  MeResponse,
  NotificationsResponse,
  OrderResponse,
  OrdersResponse,
  PrepareTransferRequest,
  PrepareTransferResponse,
  QuoteRequest,
  QuoteResponse,
  RequestsResponse,
  ResolveHandleResponse,
  SubmitTransferRequest,
  SubmitTransferResponse,
  TransactionsResponse,
} from '@fpay/shared';

import { API_URL, DEV_USER_ID } from './envConfig';

let authToken: string | null = null;
/** Set by Privy after login (M3). Until then requests fall back to the dev header. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

let refreshToken: (() => Promise<string | null>) | null = null;
/** Registered by the Privy bridge so a 401 (expired access token) refreshes once and retries. */
export function setTokenRefresher(fn: (() => Promise<string | null>) | null): void {
  refreshToken = fn;
}

export async function req<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  else if (DEV_USER_ID) headers['x-dev-user-id'] = DEV_USER_ID;

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  // Expired Privy access token → refresh once and retry transparently.
  if (res.status === 401 && !retried && refreshToken) {
    const fresh = await refreshToken().catch(() => null);
    if (fresh) {
      authToken = fresh;
      return req<T>(path, init, true);
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, typeof payload.error === 'string' ? payload.error : `http_${res.status}`, payload);
  }
  return (await res.json()) as T;
}

/** Structured API error so callers can branch on `code` (e.g. 'limit_exceeded') and show a clean
 *  message instead of a raw "path → 403 {json}" string. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public payload: Record<string, unknown> = {},
  ) {
    super(typeof payload.reason === 'string' ? payload.reason : code);
    this.name = 'ApiError';
  }
}

export const api = {
  authSync: (body: AuthSyncRequest) =>
    req<MeResponse>('/auth/sync', { method: 'POST', body: JSON.stringify(body) }),
  me: () => req<MeResponse>('/me'),
  kycVerify: (returnUrl?: string) =>
    req<KycVerifyResponse>('/kyc/verify', { method: 'POST', body: JSON.stringify({ returnUrl }) }),
  // Dev-only: reset the caller's backend KYC tier to 1 so the verification flow can be re-tested on
  // the same account. Backed by /sim/kyc/:tier, which is gated to dev/stage (403 in prod).
  devResetKyc: () => req<{ ok: true; kycTier: number }>('/sim/kyc/1', { method: 'POST' }),
  balance: () => req<BalanceResponse>('/balance'),
  transactions: () => req<TransactionsResponse>('/transactions'),
  resolve: (handle: string) =>
    req<ResolveHandleResponse>(`/users/resolve?handle=${encodeURIComponent(handle)}`),
  resolvePhone: (phone: string) =>
    req<ResolveHandleResponse>(`/users/resolve?phone=${encodeURIComponent(phone)}`),
  // Pay-by-phone enrollment. The number comes from the caller's Privy account server-side;
  // the body phone is only honored by the dev shim (no Privy configured).
  registerPhone: (phone?: string) =>
    req<{ phone: string }>('/me/phone', { method: 'POST', body: JSON.stringify(phone ? { phone } : {}) }),
  deregisterPhone: () => req<{ ok: true }>('/me/phone', { method: 'DELETE' }),
  // Dialing-default country (ISO alpha-2) — tunes local-format phone lookups only.
  setCountry: (country: string) =>
    req<{ country: string }>('/me/country', { method: 'POST', body: JSON.stringify({ country }) }),
  requests: () => req<RequestsResponse>('/requests'),
  createRequest: (body: CreateRequestRequest) =>
    req<ApiPaymentRequest>('/requests', { method: 'POST', body: JSON.stringify(body) }),
  payRequest: (id: string, transferId: string) =>
    req<{ ok: true }>(`/requests/${id}/pay`, { method: 'POST', body: JSON.stringify({ transferId }) }),
  cancelRequest: (id: string) => req<{ ok: true }>(`/requests/${id}/cancel`, { method: 'POST' }),
  prepareTransfer: (body: PrepareTransferRequest) =>
    req<PrepareTransferResponse>('/transfer/prepare', { method: 'POST', body: JSON.stringify(body) }),
  submitTransfer: (body: SubmitTransferRequest) =>
    req<SubmitTransferResponse>('/transfer/submit', { method: 'POST', body: JSON.stringify(body) }),
  faucet: (body: FaucetRequest) =>
    req<FaucetResponse>('/devnet/faucet', { method: 'POST', body: JSON.stringify(body) }),
  // ---- M1 order lifecycle ----
  createQuote: (body: QuoteRequest) =>
    req<QuoteResponse>('/orders/quote', { method: 'POST', body: JSON.stringify(body) }),
  createOrder: (body: CreateOrderRequest) =>
    req<CreateOrderResponse>('/orders', { method: 'POST', body: JSON.stringify(body) }),
  fundSubmit: (id: string, body: FundSubmitRequest) =>
    req<SubmitTransferResponse>(`/orders/${id}/fund-submit`, { method: 'POST', body: JSON.stringify(body) }),
  getOrder: (id: string) => req<OrderResponse>(`/orders/${id}`),
  listOrders: () => req<OrdersResponse>('/orders'),

  cancelOrder: (id: string) => req<{ ok: true }>(`/orders/${id}/cancel`, { method: 'POST' }),
  disputeOrder: (id: string, reason?: string) =>
    req<{ id: string; status: 'open' }>(`/orders/${id}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  orderFeedback: (id: string, up: boolean) =>
    req<{ ok: true }>(`/orders/${id}/feedback`, { method: 'POST', body: JSON.stringify({ up }) }),
  // M6: notifications inbox
  getNotifications: () => req<NotificationsResponse>('/notifications'),
  readAllNotifications: () => req<{ ok: true }>('/notifications/read-all', { method: 'POST' }),
  // M7: live FX mid rate (INR per USD) for standalone display; quotes carry their own locked rate.
  fxRate: (currency = 'INR') =>
    req<{ currency: string; rate: number; asOf: string | null }>(`/fx/rate?currency=${currency}`),
  // ---- v2 cross-chain (docs/19) ----
  crosschainQuote: (network: string, amountUsd: number, source?: string) =>
    req<CrosschainQuoteResponse>(
      `/crosschain/quote?network=${encodeURIComponent(network)}&amountUsd=${amountUsd}${source ? `&source=${encodeURIComponent(source)}` : ''}`,
    ),
  prepareCrosschain: (body: PrepareCrosschainRequest) =>
    req<PrepareCrosschainResponse>('/crosschain/prepare', { method: 'POST', body: JSON.stringify(body) }),
  submitCrosschain: (body: SubmitCrosschainRequest) =>
    req<SubmitTransferResponse>('/crosschain/submit', { method: 'POST', body: JSON.stringify(body) }),
  setEvmAddress: (address: string) =>
    req<{ address: string }>('/me/evm-address', { method: 'POST', body: JSON.stringify({ address }) }),
  depositInfo: () => req<DepositInfoResponse>('/crosschain/deposit-info'),
  depositPrepare: (body: DepositPrepareRequest) =>
    req<DepositPrepareResponse>('/crosschain/deposit-prepare', { method: 'POST', body: JSON.stringify(body) }),
  depositBalances: () => req<DepositBalancesResponse>('/crosschain/deposit-balances'),
  reportDeposit: (body: ReportDepositRequest) =>
    req<ReportDepositResponse>('/crosschain/deposit', { method: 'POST', body: JSON.stringify(body) }),
};
