// api.ts — typed fetch client for the backend, admin surface only. The auth-token core
// (setAuthToken / setTokenRefresher / req() with 401-refresh-retry / ApiError) mirrors
// apps/web/src/services/api.ts so the two clients behave identically against the same backend.
import type {
  AdminActionsResponse,
  AdminDenylistAddRequest,
  AdminDenylistResponse,
  AdminInviteMintRequest,
  AdminInvitesResponse,
  AdminMerchantsResponse,
  AdminOrderDetailResponse,
  AdminOrdersResponse,
  AdminOverviewResponse,
  AdminPayoutProviderUpdateRequest,
  AdminPayoutProvidersResponse,
  AdminRiskEventsResponse,
  AdminUserPatchRequest,
  AdminUserRoleRequest,
  AdminUserStatusRequest,
  AdminUsersResponse,
  AdminWaitlistResponse,
  MeResponse,
  AdminStakeWithdrawalsResponse,
} from '@fpay/shared';

import { apiHost } from './apiMode';
import { DEV_USER_ID } from './envConfig';

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

  // Host is read per call, not captured at import: the operator can be pointed at either backend.
  const res = await fetch(`${apiHost()}${path}`, { ...init, headers });

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
    // Read the code off `message` as well as `error`, the way web already does (its api.ts explains
    // it in full): the backend has no setErrorHandler, so a THROWN error — everything requireUserId
    // raises — lands its string in Fastify's `message` with a generic "Unauthorized" in `error`,
    // while reply.send({ error }) puts it in `error`. Reading only `error` collapsed the two 401s
    // requireUserId deliberately separates, and the console then told an operator whose token had
    // been REJECTED that they had no profile here — a different problem with a different fix.
    const code =
      typeof payload.message === 'string' && payload.message
        ? payload.message
        : typeof payload.error === 'string'
          ? payload.error
          : `http_${res.status}`;
    throw new ApiError(res.status, code, payload);
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
  invites: (cursor?: string) => req<AdminInvitesResponse>(cursored('/admin/invites', cursor)),
  actions: (cursor?: string) => req<AdminActionsResponse>(cursored('/admin/actions', cursor)),
  payoutProviders: () => req<AdminPayoutProvidersResponse>('/admin/payout-providers'),
  stakeWithdrawals: (status: 'requested' | 'released' = 'requested') =>
    req<AdminStakeWithdrawalsResponse>(`/admin/stake/withdrawals?status=${status}`),

  // writes (every one lands in the admin_actions audit trail server-side)
  // `note` is shown to the MERCHANT verbatim and is required for anything but an approval — a
  // status word with no reason behind it is not a decision they can act on.
  merchantKyb: (id: string, decision: 'approve' | 'reject' | 'review' | 'more_info', note?: string) =>
    req<{ ok: true; kybStatus: string }>(`/admin/merchants/${id}/kyb`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    }),
  // Never 'online' from here: only the LP's own switch may write that (it enforces KYB + bond).
  merchantStatus: (id: string, status: 'offline' | 'suspended') =>
    req<{ ok: true; status: string }>(`/admin/merchants/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  // Record-only: the USDC was sent by hand from the cold stake treasury; this is its signature.
  releaseStakeWithdrawal: (id: string, signature: string) =>
    req<{ ok: true }>(`/admin/stake/withdrawals/${id}/release`, { method: 'POST', body: JSON.stringify({ signature }) }),
  resolveDispute: (id: string, resolution: 'upheld' | 'rejected', note?: string) =>
    req<{ ok: true; resolution: string }>(`/admin/disputes/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution, note }),
    }),
  denylistAdd: (body: AdminDenylistAddRequest) =>
    req<{ ok: true; id: string }>('/admin/denylist', { method: 'POST', body: JSON.stringify(body) }),
  denylistRemove: (id: string) => req<{ ok: true }>(`/admin/denylist/${id}`, { method: 'DELETE' }),
  /** The response is the ONLY time these strings are handed back in bulk — show them to the operator. */
  inviteMint: (body: AdminInviteMintRequest) =>
    req<{ ok: true; codes: string[] }>('/admin/invites', { method: 'POST', body: JSON.stringify(body) }),
  inviteRevoke: (code: string) => req<{ ok: true }>(`/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  userRole: (id: string, body: AdminUserRoleRequest) =>
    req<{ ok: true; role: string }>(`/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify(body) }),
  userPatch: (id: string, body: AdminUserPatchRequest) =>
    req<{ ok: true; handle: string; displayName: string | null }>(`/admin/users/${id}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  userStatus: (id: string, body: AdminUserStatusRequest) =>
    req<{ ok: true; status: string }>(`/admin/users/${id}/status`, { method: 'POST', body: JSON.stringify(body) }),
  payoutProviderUpdate: (id: string, body: AdminPayoutProviderUpdateRequest) =>
    req<{ ok: true; enabled: boolean; priority: number }>(`/admin/payout-providers/${id}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
