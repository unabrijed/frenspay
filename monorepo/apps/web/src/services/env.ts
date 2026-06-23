// env.ts — the ONE place web env is read. NODE_ENV decides the var set. Next inlines
// `process.env.NEXT_PUBLIC_*` as STATIC literals + forces NODE_ENV (development in `next dev`,
// production in a build), so we reference both literal sets and pick by NODE_ENV:
//   development / stage  → NEXT_PUBLIC_STAGE_<KEY> (falling back to NEXT_PUBLIC_<KEY>)
//   production           → NEXT_PUBLIC_<KEY>
const isProduction = process.env.NODE_ENV === 'production';

const E = {
  apiUrl: isProduction
    ? process.env.NEXT_PUBLIC_API_URL
    : process.env.NEXT_PUBLIC_STAGE_API_URL || process.env.NEXT_PUBLIC_API_URL,
  solanaRpcUrl: isProduction
    ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL
    : process.env.NEXT_PUBLIC_STAGE_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
  devUserId: isProduction
    ? process.env.NEXT_PUBLIC_DEV_USER_ID
    : process.env.NEXT_PUBLIC_STAGE_DEV_USER_ID || process.env.NEXT_PUBLIC_DEV_USER_ID,
  devSecretKey: isProduction
    ? process.env.NEXT_PUBLIC_DEV_SECRET_KEY
    : process.env.NEXT_PUBLIC_STAGE_DEV_SECRET_KEY || process.env.NEXT_PUBLIC_DEV_SECRET_KEY,
  privyAppId: isProduction
    ? process.env.NEXT_PUBLIC_PRIVY_APP_ID
    : process.env.NEXT_PUBLIC_STAGE_PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  privyClientId: isProduction
    ? process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID
    : process.env.NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID || process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
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
