// api.ts — typed fetch client for the Railway backend. Same @pay/shared DTOs as the server.
import type {
  ApiPaymentRequest,
  AuthSyncRequest,
  BalanceResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  CreateRequestRequest,
  FaucetRequest,
  FaucetResponse,
  FundSubmitRequest,
  MeResponse,
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
} from '@pay/shared';

import { API_URL, DEV_USER_ID } from './env';

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

async function req<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
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
    const body = await res.text().catch(() => '');
    throw new Error(`${path} → ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

export const api = {
  authSync: (body: AuthSyncRequest) =>
    req<MeResponse>('/auth/sync', { method: 'POST', body: JSON.stringify(body) }),
  me: () => req<MeResponse>('/me'),
  balance: () => req<BalanceResponse>('/balance'),
  transactions: () => req<TransactionsResponse>('/transactions'),
  resolve: (handle: string) =>
    req<ResolveHandleResponse>(`/users/resolve?handle=${encodeURIComponent(handle)}`),
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
};
