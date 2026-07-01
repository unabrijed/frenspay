// api.ts — typed fetch client for the Railway backend. Same @fpay/shared DTOs as the server.
import type {
  ApiPaymentRequest,
  AuthSyncRequest,
  BalanceResponse,
  CreateRequestRequest,
  FaucetRequest,
  FaucetResponse,
  MeResponse,
  PrepareTransferRequest,
  PrepareTransferResponse,
  RequestsResponse,
  ResolveHandleResponse,
  SubmitTransferRequest,
  SubmitTransferResponse,
  TransactionsResponse,
} from '@fpay/shared';

import { API_URL, DEV_USER_ID } from './env';

let authToken: string | null = null;
/** Set by Privy after login (M3). Until then requests fall back to the dev header. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  else if (DEV_USER_ID) headers['x-dev-user-id'] = DEV_USER_ID;

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
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
};
