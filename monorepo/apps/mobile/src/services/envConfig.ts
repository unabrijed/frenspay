// envConfig.ts — the ONE place mobile env is read. Expo inlines `process.env.EXPO_PUBLIC_*` as STATIC
// literals + forces NODE_ENV (development under `expo start`, production in a release build), so
// NODE_ENV can never carry 'stage'. The tier therefore comes from EXPO_PUBLIC_APP_ENV:
//   local (default under expo start)       → EXPO_PUBLIC_LOCAL_<KEY> → EXPO_PUBLIC_STAGE_<KEY>
//   stage (a stage build sets APP_ENV)     → EXPO_PUBLIC_STAGE_<KEY>
//   production (default in a release)      → EXPO_PUBLIC_<KEY>
// Bare EXPO_PUBLIC_* names exist ONLY in release builds — dev tiers never read them. ONE exception:
// the Privy app is not tiered (exactly one app, every tier mounts it), so its two names are read bare
// on every tier — see the PRIVY_APP_ID export below.
//
// The tier block below is byte-for-byte the web's (apps/web/src/services/envConfig.ts) with the
// prefix swapped, asserted by `yarn check:env`. It cannot live in a package: Expo, like Next, only
// inlines LITERAL process.env references appearing in the app's own source.
import Constants from 'expo-constants';

const isProduction = process.env.NODE_ENV === 'production';
// A value pasted into a host's variable panel carries baggage — a trailing newline, the quotes it was
// copied inside. The backend launders every read through clean(); this is that twin, and it matters
// more here: an untrimmed tier name matches nothing and drops to the stage chain below.
const APP_ENV = (process.env.EXPO_PUBLIC_APP_ENV || (isProduction ? 'production' : 'local'))
  .trim()
  .replace(/^(['"])([\s\S]*)\1$/, '$2');
const isProdEnv = APP_ENV === 'production';
const isStageEnv = APP_ENV === 'stage';
// An unrecognised tier used to fall out of pick() into the STAGE chain — a production build quietly
// signing in against the stage Privy app while its own bare vars sat there unread. EXPO_PUBLIC_* is
// inlined, so this folds at build time: a mistyped tier fails the build instead of shipping.
if (!isProdEnv && !isStageEnv && APP_ENV !== 'local') {
  throw new Error(`EXPO_PUBLIC_APP_ENV must be local | stage | production: got ${JSON.stringify(APP_ENV)}`);
}

/** Tier chain. Args must be literal process.env.EXPO_PUBLIC_* references (Expo inlines). */
function pick(local?: string, stage?: string, prod?: string): string | undefined {
  if (isProdEnv) return prod;
  if (isStageEnv) return stage;
  return local || stage;
}

const E = {
  apiUrl: pick(
    process.env.EXPO_PUBLIC_LOCAL_API_URL,
    process.env.EXPO_PUBLIC_STAGE_API_URL,
    process.env.EXPO_PUBLIC_API_URL,
  ),
  solanaRpcUrl: pick(
    process.env.EXPO_PUBLIC_LOCAL_SOLANA_RPC_URL,
    process.env.EXPO_PUBLIC_STAGE_SOLANA_RPC_URL,
    process.env.EXPO_PUBLIC_SOLANA_RPC_URL,
  ),
  landingUrl: pick(
    process.env.EXPO_PUBLIC_LOCAL_LANDING_URL,
    process.env.EXPO_PUBLIC_STAGE_LANDING_URL,
    process.env.EXPO_PUBLIC_LANDING_URL,
  ),
};

const API_PORT = 3001; // matches the backend (apps/backend/.env PORT)

// No *_API_URL → the dev machine's LAN IP that Metro served the bundle from, so a physical device
// reaches a local backend without hardcoding an IP DHCP keeps reassigning. Only a LAN IPv4 is
// trusted (rejects tunnel domains + a localhost host); then localhost.
function lanApiUrl(): string {
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];
  if (host && /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return `http://${host}:${API_PORT}`;
  return `http://localhost:${API_PORT}`;
}

export const API_URL = E.apiUrl || lanApiUrl();
// Every tier is mainnet — there is no testnet (2026-08-30). The var only picks the RPC provider.
export const SOLANA_RPC_URL = E.solanaRpcUrl || 'https://api.mainnet-beta.solana.com';

// Dev signing path (no Privy): a seeded user id + secret key from apps/backend/.devnet/keys.json.
// SECURITY: `DEV_SECRET_KEY` is a RAW SOLANA PRIVATE KEY and every EXPO_PUBLIC_* read is inlined into
// the bundle. The reads live INSIDE the `isProduction` ternary so a release build strips them, and
// the bare (production) names are never read — same two rules as the web, asserted by check:env.
export const DEV_USER_ID = isProduction
  ? ''
  : process.env.EXPO_PUBLIC_LOCAL_DEV_USER_ID || process.env.EXPO_PUBLIC_STAGE_DEV_USER_ID || '';
export const DEV_SECRET_KEY = isProduction
  ? ''
  : process.env.EXPO_PUBLIC_LOCAL_DEV_SECRET_KEY || process.env.EXPO_PUBLIC_STAGE_DEV_SECRET_KEY || '';

// Privy. When the app id is set the app mounts Privy and uses email-OTP + the embedded Solana wallet.
// A native build ALSO needs the client id (the dashboard's app client for com.bridge.fpay).
//
// ONE Privy app, every tier — deliberately NOT routed through pick(): there is exactly one app, so
// tiering it would mean two variable names holding one value, and a stale STAGE_ twin silently
// winning over the bare name is exactly how stage kept mailing OTPs from a retired app (2026-08-31).
// Same reasoning apps/admin/src/services/envConfig.ts gives. Empty is a supported, LOUD state
// (USE_PRIVY false); there is no fallback to a prefixed name — missing beats wrong.
export const PRIVY_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID || '';
/** The NATIVE app-client of the app id above (a different client than the web's) — and no other app's. */
export const PRIVY_CLIENT_ID = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID || '';
export const USE_PRIVY = PRIVY_APP_ID.length > 0;

// The marketing site: share/invite links point here, and it is the passkey relying party.
export const LANDING_URL = (E.landingUrl || 'https://frenspay.xyz').replace(/\/$/, '');

export const IS_LOCAL_ENV = APP_ENV === 'local';
export const IS_DEV = !isProduction;
