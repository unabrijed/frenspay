import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { config } from '../envConfig';

export interface CampaignIdentity {
  subject: string;
  email: string;
  walletAddress?: string;
  solanaWalletAddress?: string;
  xSubject?: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const dynamicConfigured = () => uuid.test(config.dynamicEnvironmentId);
let cached: { id: string; key: JWTVerifyGetKey } | undefined;
export async function verifyDynamicToken(token: string, keyOverride?: JWTVerifyGetKey) {
  const id = config.dynamicEnvironmentId;
  if (!dynamicConfigured()) throw new Error('dynamic_not_configured');
  if (!cached || cached.id !== id) cached = { id, key: createRemoteJWKSet(
    new URL(`https://app.dynamicauth.com/api/v0/sdk/${id}/.well-known/jwks`),
    { timeoutDuration: 5000 },
  ) };
  const { payload } = await jwtVerify(token, keyOverride ?? cached.key, {
    algorithms: ['RS256'],
    issuer: [`app.dynamicauth.com/${id}`, `app.dynamic.xyz/${id}`],
    ...(config.dynamicAudience ? { audience: config.dynamicAudience } : {}),
    requiredClaims: ['sub', 'iat', 'exp', 'scope'],
    clockTolerance: 5,
  });
  if (!payload.sub || !uuid.test(payload.sub) || typeof payload.iat !== 'number' ||
      payload.iat > Date.now() / 1000 + 5 ||
      (payload.environment_id !== undefined && payload.environment_id !== id) ||
      typeof payload.scope !== 'string' || !payload.scope.split(/\s+/).includes('user:basic'))
    throw new Error('invalid_dynamic_session');
  return payload.sub;
}

/** Only data fetched directly from Dynamic with a verified access token is accepted. */
export function identityFromDynamicProfile(profile: any, subject: string): CampaignIdentity {
  if (profile?.id !== subject || profile.projectEnvironmentId !== config.dynamicEnvironmentId ||
      !Array.isArray(profile.verifiedCredentials)) throw new Error('dynamic_identity_mismatch');
  const credentials = profile.verifiedCredentials;
  const emails = credentials.filter((c: any) => c.format === 'email' && typeof c.email === 'string')
    .map((c: any) => c.email.trim().toLowerCase());
  const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
  if (!email || !emails.includes(email)) throw new Error('verified_email_required');
  const wallets = credentials.filter((c: any) => c.format === 'blockchain' &&
    c.chain === 'eip155' && c.wallet_provider === 'embeddedWallet' &&
    typeof c.address === 'string' && /^0x[0-9a-f]{40}$/i.test(c.address));
  // Multiple eligible wallets need an explicit, verified selection rather than array order.
  if (wallets.length > 1) throw new Error('ambiguous_dynamic_wallet');
  const solana = credentials.filter((c: any) => c.format === 'blockchain' &&
    c.chain === 'solana' && c.wallet_provider === 'embeddedWallet' &&
    typeof c.address === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(c.address));
  if (solana.length > 1) throw new Error('ambiguous_dynamic_solana_wallet');
  const x = credentials.find((c: any) => c.format === 'oauth' && c.oauth_provider === 'twitter' &&
    typeof c.oauth_account_id === 'string');
  return { subject: `dynamic:${config.dynamicEnvironmentId}:${subject}`, email,
    walletAddress: wallets[0]?.address.toLowerCase(), solanaWalletAddress: solana[0]?.address, xSubject: x?.oauth_account_id };
}
export async function authenticateDynamic(token: string): Promise<CampaignIdentity> {
  const subject = await verifyDynamicToken(token);
  const response = await fetch(`https://app.dynamicauth.com/api/v0/sdk/${config.dynamicEnvironmentId}/users`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!response.ok) throw new Error('dynamic_profile_unavailable');
  return identityFromDynamicProfile(await response.json(), subject);
}
