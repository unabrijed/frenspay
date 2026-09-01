// api.ts — typed fetch client for the backend, LP-console flavoured.
//
// Same shape as apps/web's and apps/admin's: a module-scoped bearer token the Privy bridge
// registers, one transparent refresh-and-retry on 401, and a structured ApiError so callers branch
// on `code` rather than parsing a string.
//
// The content-type rule is NOT cosmetic and is the one thing worth copying carefully from
// apps/web (admin's older version sets it unconditionally): Fastify's default parser answers a
// bodyless POST claiming application/json with 400 FST_ERR_CTP_EMPTY_JSON_BODY, *before* the auth
// preHandler, so the route never runs. This console makes several bodyless POSTs — taking an order,
// handing it back, cancelling a stake withdrawal — and every one of them would silently 400.
// `scripts/check-api-headers.ts` asserts it.
import { API_URL, DEV_USER_ID } from './envConfig';

let authToken: string | null = null;
/** Set by the Privy bridge after login. Until then requests fall back to the dev header. */
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
 * Fires only when the server CONFIRMS this session has no account — distinct from an expired token,
 * which the refresh-and-retry below already handles. One hook at the API layer beats a catch in
 * every caller, because the Privy session outlives our row: without it every poll and every action
 * would keep running against a dead account. The handler's answer is AuthGate's FinishSetup — the
 * account gets made or adopted through /auth/sync — not a sign-out.
 */
export function setSessionRevokedHandler(fn: (() => void) | null): void {
  onSessionRevoked = fn;
}

let onAccountSuspended: (() => void) | null = null;
export function setAccountSuspendedHandler(fn: (() => void) | null): void {
  onAccountSuspended = fn;
}

export async function req<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const headers: Record<string, string> = {
    // Only when there IS a body — see the header comment.
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
    // The two answers meaning "this session has no account". Read `message` too: the backend has no
    // setErrorHandler, so Fastify's default serializer puts our string there and a generic
    // "Unauthorized" in `error`.
    if (payload.message === 'no_account' || payload.error === 'user_not_found') onSessionRevoked?.();
    if (payload.error === 'account_suspended' || payload.error === 'account_deleted') onAccountSuspended?.();
    throw new ApiError(res.status, typeof payload.error === 'string' ? payload.error : `http_${res.status}`, payload);
  }
  return (await res.json()) as T;
}

/** Structured API error so callers branch on `code` (e.g. 'order_already_taken') and show clean
 *  copy instead of a raw status string. */
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
