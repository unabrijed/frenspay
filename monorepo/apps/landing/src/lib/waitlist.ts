import { readRef } from '@/components/ref';

import { API_URL as API } from '@/lib/envConfig';

export class WaitlistApiError extends Error {
  constructor(readonly status: number) {
    super(`Waitlist request failed with ${status}`);
    this.name = 'WaitlistApiError';
  }
}

/** What the f list hands back: this member's own three invite codes, to pass on. Stable across
 *  re-submits — joining twice returns the same three and spends no second code. */
export interface JoinResult {
  invites: string[];
}

/**
 * Join the f list. The code is spent by THIS call — there is no separate check first, because a
 * check that says "good" and a write that spends it are two moments and two people fit between them.
 *
 * 404 = not a code (or revoked), 409 = already used, 400 = bad email, 429 = too many tries.
 */
export async function joinWaitlist(email: string, code: string, signal?: AbortSignal): Promise<JoinResult> {
  const response = await fetch(`${API}/waitlist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code, ref: readRef() ?? undefined }),
    signal,
  });

  if (!response.ok) throw new WaitlistApiError(response.status);
  const body = (await response.json()) as { invites?: string[] };
  return { invites: body.invites ?? [] };
}
