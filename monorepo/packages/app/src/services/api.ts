// api.ts — typed fetch client for the Railway backend. Same @fpay/shared DTOs as the server.
import { type AddMemberRequest, type ApiGroupDetail, type ApiPaymentRequest, type AuthSyncRequest, type BalanceResponse, type CreateGroupRequest, type CreateOrderRequest, type CreateOrderResponse, type CreateRequestRequest, type CrosschainQuoteResponse, type DepositBalancesResponse, type DepositInfoResponse, type DepositPrepareRequest, type DepositPrepareResponse, type FundSubmitRequest, type GroupsResponse, type KycVerifyResponse, type MeResponse, type MoveTransferRequest, type NotificationsResponse, type OrderResponse, type OrdersResponse, type PrepareCrosschainRequest, type PrepareCrosschainResponse, type PrepareTransferRequest, type PrepareTransferResponse, type PushTokenRequest, type QuoteRequest, type QuoteResponse, type ReportDepositRequest, type ReportDepositResponse, type RequestsResponse, type ResolveHandleResponse, type SplitRequest, type SubmitCrosschainRequest, type SubmitTransferRequest, type SubmitTransferResponse, type TransactionsResponse } from '@fpay/shared';

import { platform } from '../platform';
import type { FlistResponse, PrelaunchAccount, PrelaunchQuote, PrelaunchSpend, PrelaunchTransaction } from '@fpay/shared';

/** Access is checked before the account bridge mounts, using the current Privy session directly. */
export function requestFlist(getToken: () => Promise<string | null>, code?: string): Promise<FlistResponse> {
  return req<FlistResponse>(`/flist/${code === undefined ? 'me' : 'join'}`, {
    method: code === undefined ? 'GET' : 'POST',
    ...(code === undefined ? {} : { body: JSON.stringify({ code }) }),
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  }, false, getToken);
}

// Bounded waits for the campaign UI. A timeout is ambiguous for writes: spend callers retain
// their idempotency key and recover the original result rather than creating another payment.
function campaignReq<T>(path: string, init?: RequestInit): Promise<T> {
  return req<T>(path, {
    ...init,
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(30_000) : undefined,
  });
}
export const prelaunchApi = {
  session: () => campaignReq<PrelaunchAccount>('/prelaunch/session', { method: 'POST' }),
  account: () => campaignReq<PrelaunchAccount>('/prelaunch/account'),
  profile: (name: string, country: string) => campaignReq<PrelaunchAccount>('/prelaunch/profile', {
    method: 'POST', body: JSON.stringify({ name, country }),
  }),
  syncBalance: () => campaignReq<PrelaunchAccount>('/prelaunch/balance/sync', { method: 'POST' }),
  phoneStart: (phone: string) => campaignReq<{ ok: true }>('/prelaunch/phone/start', {
    method: 'POST', body: JSON.stringify({ phone }),
  }),
  phoneConfirm: (code: string) => campaignReq<PrelaunchAccount>('/prelaunch/phone/confirm', {
    method: 'POST', body: JSON.stringify({ code }),
  }),
  quote: (qr: string, amountSgd: string) => campaignReq<PrelaunchQuote>('/prelaunch/quotes', {
    method: 'POST', body: JSON.stringify({ qr, amountSgd }),
  }),
  spend: (quoteId: string, idempotencyKey: string) => campaignReq<PrelaunchSpend>('/prelaunch/spends', {
    method: 'POST', body: JSON.stringify({ quoteId, idempotencyKey }),
  }),
  history: () => campaignReq<{ spends: PrelaunchSpend[] }>('/prelaunch/history'),
  withdrawal: (to: string, amount: string) => campaignReq<PrelaunchTransaction>('/prelaunch/withdraw/prepare', {
    method: 'POST', body: JSON.stringify({ to, amount }),
  }),
};

let authToken: string | null = null;
/** Set by Privy after login (M3). Until then requests fall back to the dev header. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

let refreshToken: ((force?: boolean) => Promise<string | null>) | null = null;
/** Registered by the Privy bridge so a 401 (expired access token) refreshes once and retries. */
export function setTokenRefresher(fn: ((force?: boolean) => Promise<string | null>) | null): void {
  refreshToken = fn;
}

let onSessionRevoked: (() => void) | null = null;
let onFlistRequired: (() => void) | null = null;
/** Customer web can return to inline invite entry when server membership changes. */
export function setFlistRequiredHandler(fn: (() => void) | null): void {
  onFlistRequired = fn;
}
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

/** Fetch's timeout does not cover the SDK work that happens before fetch. */
function withinSignal<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Request timed out'));
    if (signal.aborted) { work.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function req<T>(path: string, init?: RequestInit, retried = false, sessionToken?: (force?: boolean) => Promise<string | null>): Promise<T> {
  // Only when there IS a body. Fastify's default parser answers a bodyless POST that claims
  // application/json with 400 FST_ERR_CTP_EMPTY_JSON_BODY — before the auth preHandler, so the
  // route never runs. That silently killed every no-body POST we have (invite ack, cancel
  // request/order, mark-all-read, the dev KYC reset).
  const headers: Record<string, string> = {
    ...(init?.body ? { 'content-type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  // The token is asked for on EVERY call — both Privy SDKs say to (a local read while it is fresh, a
  // refresh when it is about to expire), so a request never carries one the SDK has already
  // rotated. The registered refresher IS that provider; the cached copy is the fallback (and what
  // the dev signer path sets), and the 401 retry below still covers a token the SERVER rejects.
  const tokenProvider = sessionToken ?? refreshToken;
  const token = (tokenProvider ? await withinSignal(tokenProvider(), init?.signal) : null) ?? (sessionToken ? null : authToken);
  if (sessionToken && !token) throw new ApiError(401, 'unauthorized');
  if (token) headers.authorization = `Bearer ${token}`;
  else if (platform().env.devUserId) headers['x-dev-user-id'] = platform().env.devUserId;

  const res = await fetch(`${platform().env.apiUrl}${path}`, { ...init, headers });

  // Expired Privy access token → refresh once and retry transparently.
  if (res.status === 401 && !retried && tokenProvider) {
    const fresh = await withinSignal(tokenProvider(true), init?.signal);
    if (fresh) {
      if (!sessionToken) authToken = fresh;
      return req<T>(path, init, true, sessionToken);
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
    if (payload.error === 'flist_required' || payload.error === 'invite_required') onFlistRequired?.();
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
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined, // Hermes may lack the static
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
  // ---- trips & splitting (docs/04 §Trips): a group is a roster; an expense is a transfer; a share is a request ----
  groups: () => req<GroupsResponse>('/groups'),
  createGroup: (body: CreateGroupRequest) => req<{ id: string }>('/groups', { method: 'POST', body: JSON.stringify(body) }),
  groupDetail: (id: string) => req<ApiGroupDetail>(`/groups/${id}`),
  addMember: (id: string, body: AddMemberRequest) =>
    req<{ ok: true }>(`/groups/${id}/members`, { method: 'POST', body: JSON.stringify(body) }),
  removeMember: (id: string, userId: string) => req<{ ok: true }>(`/groups/${id}/members/${userId}`, { method: 'DELETE' }),
  deleteGroup: (id: string) => req<{ ok: true }>(`/groups/${id}`, { method: 'DELETE' }),
  moveTransfer: (id: string, body: MoveTransferRequest) =>
    req<{ ok: true }>(`/transfers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  splitTransfer: (id: string, body: SplitRequest) =>
    req<{ ok: true }>(`/transfers/${id}/split`, { method: 'POST', body: JSON.stringify(body) }),
  prepareTransfer: (body: PrepareTransferRequest) =>
    req<PrepareTransferResponse>('/transfer/prepare', { method: 'POST', body: JSON.stringify(body) }),
  submitTransfer: (body: SubmitTransferRequest) =>
    req<SubmitTransferResponse>('/transfer/submit', { method: 'POST', body: JSON.stringify(body) }),
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
  // Push (phone app): register after sign-in, unregister on sign-out.
  registerPushToken: (body: PushTokenRequest) => req<{ ok: true }>('/me/push-token', { method: 'POST', body: JSON.stringify(body) }),
  unregisterPushToken: (token: string) => req<{ ok: true }>('/me/push-token', { method: 'DELETE', body: JSON.stringify({ token }) }),
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


export const friendsApi = {
  list: () => req<{friends: import('@fpay/shared').SavedFriend[]}>('/friends'),
  save: (handle: string, favorite?: boolean) => req<{ok:true}>('/friends', {method:'PUT',body:JSON.stringify({handle,favorite})}),
  remove: (userId: string) => req<{ok:true}>(`/friends/${userId}`, {method:'DELETE'}),
  suggestions: (groupId?:string) => {
    const params = new URLSearchParams({timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'});
    if(groupId) params.set('groupId',groupId);
    return req<import('@fpay/shared').PeopleSuggestions>(`/friends/suggestions?${params}`);
  },
  invite: () => req<{code:string|null}>('/friends/invite'),
};
export const expensesApi = {
  summary: (filter:'all'|'personal'|'trips') => req<{spentUsd:string;yourShareUsd:string}>(`/expenses/summary?${new URLSearchParams({filter,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'})}`),
  list: (cursor?:string) => req<{expenses: import('@fpay/shared').ApiExpense[];nextCursor?:string}>(`/expenses${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`),
  get: (id:string) => req<import('@fpay/shared').ApiExpense>(`/expenses/${id}`),
  forTransfer: (id:string) => req<{expense:import('@fpay/shared').ApiExpense|null}>(`/expenses/for-transfer/${id}`),
  create: (transferId:string,groupId?:string) => req<import('@fpay/shared').ApiExpense>('/expenses',{method:'POST',body:JSON.stringify({transferId,groupId})}),
  edit: (id:string,body:import('@fpay/shared').ExpenseEdit) => req<import('@fpay/shared').ApiExpense>(`/expenses/${id}`,{method:'PATCH',body:JSON.stringify(body)}),
  publish: (id:string,version:number) => req<import('@fpay/shared').ApiExpense>(`/expenses/${id}/publish`,{method:'POST',body:JSON.stringify({version})}),
  payments: (cursor?:string) => req<{payments:import('@fpay/shared').ExpensePayment[];nextCursor?:string}>(`/expenses/eligible-payments${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`),
  link: (id:string,transferId:string,version:number) => req<import('@fpay/shared').ApiExpense>(`/expenses/${id}/payments`,{method:'POST',body:JSON.stringify({transferId,version})}),
  unlink: (id:string,transferId:string,version:number) => req<import('@fpay/shared').ApiExpense>(`/expenses/${id}/payments/${transferId}`,{method:'DELETE',body:JSON.stringify({version})}),
};

/** Shared transport only; campaign endpoints remain in their own typed client. */
export const request = req;
