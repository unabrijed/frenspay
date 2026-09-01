// privy.ts — Privy access-token verification (@privy-io/server-auth).
// The mobile client sends the Privy access token as `Authorization: Bearer <token>`;
// we verify it and map the Privy DID (claims.userId) to our DB user in auth.ts.
import { PrivyClient } from '@privy-io/server-auth';

import { config } from '../envConfig';

let _client: PrivyClient | null = null;
function client(): PrivyClient {
  if (!_client) {
    if (!config.privyAppId || !config.privyAppSecret) throw new Error('Privy is not configured');
    _client = new PrivyClient(config.privyAppId, config.privyAppSecret);
  }
  return _client;
}

export const privyConfigured = (): boolean => Boolean(config.privyAppId && config.privyAppSecret);

/** Verify a Privy access token; returns the user's Privy DID. Throws if invalid/expired. */
export async function verifyAccessToken(token: string): Promise<{ privyDid: string }> {
  const claims = await client().verifyAuthToken(token, config.privyVerificationKey || undefined);
  return { privyDid: claims.userId };
}

/** The user's Privy-verified email — the address they actually logged in with, since the web app's
 *  only login method is email + OTP. Persisted to users.email at sync so the admin console can show
 *  it and so ADMIN_EMAILS can match a real, provider-verified address rather than a self-claimed
 *  one. (Phone is NOT read from Privy: its free plan only reaches US/CA — services/phoneOtp.ts.) */
export async function getLinkedEmail(privyDid: string): Promise<string | null> {
  // ponytail: getUser(id) is the rate-limit-deprecated lookup; switch to identity-token reads
  // if Privy volume ever matters.
  const user = await client().getUser(privyDid);
  // Canonical form, at the only entrance: lowercase + trimmed. Every reader of users.email is an
  // exact match (adoption, findUserByEmail, uq_users_email) and Privy documents nothing about the
  // casing it hands back — one mailbox spelled two ways would be two accounts. 0025 enforces the
  // same rule on the column.
  const address = user.email?.address;
  return address ? address.trim().toLowerCase() : null;
}
