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

/** The user's Privy-verified linked phone (raw, pre-normalization), or null if none linked.
 *  This is the ONLY source for pay-by-phone enrollment — the number always comes from the
 *  caller's own Privy account (UPI's own-number-only mapper rule for free). */
export async function getLinkedPhone(privyDid: string): Promise<string | null> {
  // ponytail: getUser(id) is the rate-limit-deprecated lookup; switch to identity-token reads
  // if Privy volume ever matters.
  const user = await client().getUser(privyDid);
  return user.phone?.number ?? null;
}
