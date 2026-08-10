// api.ts — typed fetch client for the backend, admin surface only. The auth-token core
// (setAuthToken / setTokenRefresher / req() with 401-refresh-retry / ApiError) mirrors
// apps/web/src/services/api.ts so the two clients behave identically against the same backend.
import type {
  AdminActionsResponse,
  AdminDenylistAddRequest,
  AdminDenylistResponse,
  AdminMerchantsResponse,
  AdminOrderDetailResponse,
  AdminOrdersResponse,
  AdminOverviewResponse,
  AdminRiskEventsResponse,
  AdminUsersResponse,
  AdminWaitlistResponse,
  MeResponse,
} from '@fpay/shared';

import { API_URL, DEV_USER_ID } from './envConfig';

let authToken: string | null = null;
/** Set by Privy after login. Until then requests fall back to the dev header. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

let refreshToken: (() => Promise<string | null>) | null = null;
/** Registered by Providers so a 401 (expired access token) refreshes once and retries. */
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

/** Structured API error so callers can branch on `status`/`code` (e.g. 403 → not-authorized). */
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

const cursored = (path: string, cursor?: string) =>
  cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;

export const api = {
  me: () => req<MeResponse>('/me'),

  // reads
  overview: () => req<AdminOverviewResponse>('/admin/overview'),
  orders: (cursor?: string) => req<AdminOrdersResponse>(cursored('/admin/orders', cursor)),
  order: (id: string) => req<AdminOrderDetailResponse>(`/admin/orders/${id}`),
  waitlist: () => req<AdminWaitlistResponse>('/admin/waitlist'),
  users: (cursor?: string) => req<AdminUsersResponse>(cursored('/admin/users', cursor)),
  merchants: () => req<AdminMerchantsResponse>('/admin/merchants'),
  riskEvents: (cursor?: string) => req<AdminRiskEventsResponse>(cursored('/admin/risk-events', cursor)),
  denylist: () => req<AdminDenylistResponse>('/admin/denylist'),
  actions: (cursor?: string) => req<AdminActionsResponse>(cursored('/admin/actions', cursor)),

  // writes (every one lands in the admin_actions audit trail server-side)
  merchantKyb: (id: string, decision: 'approve' | 'reject') =>
    req<{ ok: true; kybStatus: string }>(`/admin/merchants/${id}/kyb`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  merchantStatus: (id: string, status: 'online' | 'offline' | 'suspended') =>
    req<{ ok: true; status: string }>(`/admin/merchants/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  resolveDispute: (id: string, resolution: 'upheld' | 'rejected', note?: string) =>
    req<{ ok: true; resolution: string }>(`/admin/disputes/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution, note }),
    }),
  denylistAdd: (body: AdminDenylistAddRequest) =>
    req<{ ok: true; id: string }>('/admin/denylist', { method: 'POST', body: JSON.stringify(body) }),
  denylistRemove: (id: string) => req<{ ok: true }>(`/admin/denylist/${id}`, { method: 'DELETE' }),
};
