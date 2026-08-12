// invite.ts — the door. Checks an invite code against the backend before sending anyone to the app.
//
// Deliberately a CHECK and not a claim: the code is only spent by the app's signup, inside the
// transaction that creates the account. So a 200 here is "this was good a moment ago", not a
// reservation — two people holding the same code both pass, and exactly one of them wins at signup.
// The alternative would mean holding a database lock across a redirect and a whole registration.
import { API_URL as API } from '@/lib/envConfig';

export class InviteApiError extends Error {
  constructor(readonly status: number) {
    super(`Invite check failed with ${status}`);
    this.name = 'InviteApiError';
  }
}

/** Loose client-side shape check, so an obviously-wrong entry never costs a request against the
 *  10/min rate limit. The server canonicalises for real — this only filters the hopeless. */
export const looksLikeCode = (raw: string): boolean => raw.replace(/[^0-9a-zA-Z]/g, '').length >= 8;

/** Returns the CANONICAL code to forward to the app. Throws InviteApiError otherwise:
 *  404 = not a code (or revoked), 409 = already used, 429 = too many tries. */
export async function checkInvite(code: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${API}/invite/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
    signal,
  });

  if (!response.ok) throw new InviteApiError(response.status);
  const body = (await response.json()) as { code?: string };
  // Forward the server's canonical form, not what was typed: 'fp 7k2m qxwd' and 'FP-7K2M-QXWD' are
  // one code, and normalising once here means no other hop has to know that.
  return body.code ?? code;
}
