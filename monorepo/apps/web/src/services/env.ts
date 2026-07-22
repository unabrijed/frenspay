// env.ts — the ONE place web env is read. Next inlines `process.env.NEXT_PUBLIC_*` as STATIC
// literals + forces NODE_ENV (development in `next dev`, production in a build), so NODE_ENV can
// never carry 'stage'. The tier therefore comes from NEXT_PUBLIC_APP_ENV:
//   local (default under `next dev`)      → NEXT_PUBLIC_LOCAL_<KEY> → NEXT_PUBLIC_STAGE_<KEY>
//   stage (a stage deploy sets APP_ENV)   → NEXT_PUBLIC_STAGE_<KEY>
//   production (default in a build)       → NEXT_PUBLIC_<KEY>
// Bare NEXT_PUBLIC_* names exist ONLY in production builds/hosts — dev tiers never read them.
const isProduction = process.env.NODE_ENV === 'production';
const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV || (isProduction ? 'production' : 'local');
const isProdEnv = APP_ENV === 'production';
const isStageEnv = APP_ENV === 'stage';

/** Tier chain. Args must be literal process.env.NEXT_PUBLIC_* references (Next inlines). */
function pick(local?: string, stage?: string, prod?: string): string | undefined {
  if (isProdEnv) return prod;
  if (isStageEnv) return stage;
  return local || stage;
}

const E = {
  apiUrl: pick(
    process.env.NEXT_PUBLIC_LOCAL_API_URL,
    process.env.NEXT_PUBLIC_STAGE_API_URL,
    process.env.NEXT_PUBLIC_API_URL,
  ),
  solanaRpcUrl: pick(
    process.env.NEXT_PUBLIC_LOCAL_SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_STAGE_SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
  ),
  devUserId: pick(
    process.env.NEXT_PUBLIC_LOCAL_DEV_USER_ID,
    process.env.NEXT_PUBLIC_STAGE_DEV_USER_ID,
    process.env.NEXT_PUBLIC_DEV_USER_ID,
  ),
  devSecretKey: pick(
    process.env.NEXT_PUBLIC_LOCAL_DEV_SECRET_KEY,
    process.env.NEXT_PUBLIC_STAGE_DEV_SECRET_KEY,
    process.env.NEXT_PUBLIC_DEV_SECRET_KEY,
  ),
  privyAppId: pick(
    process.env.NEXT_PUBLIC_LOCAL_PRIVY_APP_ID,
    process.env.NEXT_PUBLIC_STAGE_PRIVY_APP_ID,
    process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  ),
  privyClientId: pick(
    process.env.NEXT_PUBLIC_LOCAL_PRIVY_CLIENT_ID,
    process.env.NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID,
    process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
  ),
};

// The app always talks to the real backend. API_URL defaults to the backend URL; override per
// environment via *_API_URL (e.g. http://localhost:3001 when running the backend locally).
const DEFAULT_API_URL = 'http://localhost:3001';
export const API_URL = E.apiUrl || DEFAULT_API_URL;
export const SOLANA_RPC_URL = E.solanaRpcUrl || 'https://api.devnet.solana.com';

// Dev signing path (no Privy): a seeded user id + secret key from apps/backend/.devnet/keys.json.
export const DEV_USER_ID = E.devUserId ?? '';
export const DEV_SECRET_KEY = E.devSecretKey ?? '';

// Privy. When the app id is set the app mounts Privy and uses email-OTP + the embedded Solana wallet.
export const PRIVY_APP_ID = E.privyAppId ?? '';
export const PRIVY_CLIENT_ID = E.privyClientId ?? '';
export const USE_PRIVY = PRIVY_APP_ID.length > 0;

// Dev-only build flag: true under `next dev` (yarn web), false in a production build. Gates testing
// affordances (e.g. the Settings "Reset for testing" action) so they never ship to a prod bundle.
export const IS_DEV = !isProduction;
