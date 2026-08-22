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

let onSessionRevoked: (() => void) | null = null;
/**
 * Registered by the Privy bridge. Fires only when the server CONFIRMS this session has no account —
 * the row was deleted or access was revoked — never on a transient failure. Distinct from an expired
 * token, which the refresh-and-retry in `req()` already handles.
 *
 * It lives here, not in the store's load(), because the Privy session outlives our row: every other
 * caller (refresh(), the 12s poller, any user action) would otherwise keep running against a dead
 * account, and the persisted handle/tier would render it as signed in indefinitely.
 */
export function setSessionRevokedHandler(fn: (() => void) | null): void {
  onSessionRevoked = fn;
}

let onAccountSuspended: (() => void) | null = null;
/**
 * Fired when the backend answers 403 `account_suspended` (admin froze the account — the preHandler
 * refuses every request, so this can surface from ANY call: load, refresh, sync, a send). One hook
 * at the API layer beats a catch in each caller; the registered handler flips the store flag that
 * renders the full-screen "account paused" state instead of a silent $0 dashboard.
 */
export function setAccountSuspendedHandler(fn: (() => void) | null): void {
  onAccountSuspended = fn;
}

let onAccountDeleted: (() => void) | null = null;
/** Fired on 403 `account_deleted` — same seam as suspension, its own screen (deleted ≠ paused). */
export function setAccountDeletedHandler(fn: (() => void) | null): void {
  onAccountDeleted = fn;
}

export async function req<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  // Only when there IS a body. Fastify's default parser answers a bodyless POST that claims
  // application/json with 400 FST_ERR_CTP_EMPTY_JSON_BODY — before the auth preHandler, so the
  // route never runs. That silently killed every no-body POST we have (invite ack, cancel
  // request/order, mark-all-read, the dev KYC reset).
  const headers: Record<string, string> = {
    ...(init?.body ? { 'content-type': 'application/json' } : {}),
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
    // The two answers that mean "this session has no account": `no_account` from requireUserId, and
    // `user_not_found` from GET /me. Read off `message` because the backend has no setErrorHandler,
    // so Fastify's default serializer puts our string there and a generic "Unauthorized" in `error`.
    // Normalized to ONE code because callers branch on it: the store's /me probe reads "does this
    // Privy identity have an account?" off exactly this, and `error` would otherwise say
    // "Unauthorized" for the 401 shape and 'user_not_found' for the 404 one.
    const noAccount = payload.message === 'no_account' || payload.error === 'user_not_found';
    if (noAccount) onSessionRevoked?.();
    // Sent via reply.send() in authPreHandler, so the code is in `error` (not Fastify's `message`).
    if (payload.error === 'account_suspended') onAccountSuspended?.();
    if (payload.error === 'account_deleted') onAccountDeleted?.();
    throw new ApiError(
      res.status,
      noAccount ? 'no_account' : typeof payload.error === 'string' ? payload.error : `http_${res.status}`,
      payload,
    );
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
  /** One-way: after this /me stops returning the invite strings. */
  acknowledgeInvites: () => req<{ ok: true }>('/me/invites/ack', { method: 'POST' }),
  // The one call with its own deadline: it fronts a vendor round trip, and without it a stalled
  // backend leaves the promise unsettled forever — the verify sheet then "loads" with no error and
  // no way back. NOT made the default in `req()`: a blanket abort on a money submit would report
  // failure for a transfer the server already accepted.
  kycVerify: (returnUrl?: string) =>
    req<KycVerifyResponse>('/kyc/verify', {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
      signal: AbortSignal.timeout(20_000),
    }),
  // Dev-only: reset the caller's backend KYC tier to 1 so the verification flow can be re-tested on
  // the same account. Backed by /sim/kyc/:tier, which is gated to dev/stage (403 in prod).
  devResetKyc: () => req<{ ok: true; kycTier: number }>('/sim/kyc/1', { method: 'POST' }),
  balance: () => req<BalanceResponse>('/balance'),
  transactions: () => req<TransactionsResponse>('/transactions'),
  resolve: (handle: string) =>
    req<ResolveHandleResponse>(`/users/resolve?handle=${encodeURIComponent(handle)}`),
  resolvePhone: (phone: string) =>
    req<ResolveHandleResponse>(`/users/resolve?phone=${encodeURIComponent(phone)}`),
  // Pay-by-phone enrollment: our own OTP (backend services/phoneOtp.ts). start sends the code to the
  // number; confirm enrolls the number that received it. Errors arrive as ApiError codes:
  // invalid_phone · phone_taken (409) · bad_code · code_expired · too_many_attempts (429) · otp_unavailable (502).
  startPhone: (phone: string) =>
    req<{ ok: true }>('/me/phone/start', { method: 'POST', body: JSON.stringify({ phone }) }),
  confirmPhone: (code: string) =>
    req<{ phone: string }>('/me/phone/confirm', { method: 'POST', body: JSON.stringify({ code }) }),
  deregisterPhone: () => req<{ ok: true }>('/me/phone', { method: 'DELETE' }),
  // Dialing-default country (ISO alpha-2) — tunes local-format phone lookups only.
  setCountry: (country: string) =>
    req<{ country: string }>('/me/country', { method: 'POST', body: JSON.stringify({ country }) }),
  // Currency prefs (server-stored, follow the user across devices). null local = automatic.
  setPreferredCurrency: (currency: string) =>
    req<{ currency: string }>('/me/preferred-currency', { method: 'POST', body: JSON.stringify({ currency }) }),
  setLocalCurrency: (currency: string | null) =>
    req<{ currency: string | null }>('/me/local-currency', { method: 'POST', body: JSON.stringify({ currency }) }),
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
