// envConfig.ts — the ONE place web env is read. Next inlines `process.env.NEXT_PUBLIC_*` as STATIC
// literals + forces NODE_ENV (development in `next dev`, production in a build), so NODE_ENV can
// never carry 'stage'. The tier therefore comes from NEXT_PUBLIC_APP_ENV:
//   local (default under `next dev`)      → NEXT_PUBLIC_LOCAL_<KEY> → NEXT_PUBLIC_STAGE_<KEY>
//   stage (a stage deploy sets APP_ENV)   → NEXT_PUBLIC_STAGE_<KEY>
//   production (default in a build)       → NEXT_PUBLIC_<KEY>
// Bare NEXT_PUBLIC_* names exist ONLY in production builds/hosts — dev tiers never read them.
//
// This file is the REFERENCE implementation of the tier block. apps/admin and apps/landing carry a
// byte-identical copy of it, asserted by `yarn check:env`. It deliberately is NOT imported from
// @fpay/shared: Next only inlines LITERAL process.env references appearing in the app's own source,
// so a shared reader would resolve to undefined at runtime. (The backend can't import it either —
// runtime value imports from @fpay/shared fail under tsx; see apps/backend/src/envConfig.ts.)
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
  landingUrl: pick(
    process.env.NEXT_PUBLIC_LOCAL_LANDING_URL,
    process.env.NEXT_PUBLIC_STAGE_LANDING_URL,
    process.env.NEXT_PUBLIC_LANDING_URL,
  ),
};

// The app always talks to the real backend. API_URL defaults to the backend URL; override per
// environment via *_API_URL (e.g. http://localhost:3001 when running the backend locally).
const DEFAULT_API_URL = 'http://localhost:3001';
export const API_URL = E.apiUrl || DEFAULT_API_URL;
export const SOLANA_RPC_URL = E.solanaRpcUrl || 'https://api.devnet.solana.com';

// Dev signing path (no Privy): a seeded user id + secret key from apps/backend/.devnet/keys.json.
//
// SECURITY — read this before touching the shape below. `DEV_SECRET_KEY` is a RAW SOLANA PRIVATE
// KEY, and every NEXT_PUBLIC_* read is inlined into the browser bundle as a literal. Two rules make
// it impossible to ship:
//
//   1. The reads live INSIDE the `isProduction` ternary, not in the `E` object above. `E` is an
//      eagerly-constructed literal that other exports depend on, so it can never be eliminated —
//      putting the key there inlines it into a production bundle no matter what the export does with
//      it afterwards. (Measured: gating only the export still leaked the bytes into three chunks.)
//      `isProduction` folds to a compile-time constant, so here the whole branch is dead code.
//   2. The bare (production) name is NEVER read. A dev signing key has no production tier by
//      construction, so setting `NEXT_PUBLIC_DEV_SECRET_KEY` on a prod host does nothing at all.
//
// `yarn check:env` builds with a sentinel key set and greps the chunks, so this is asserted rather
// than assumed. The name still says SECRET on purpose: it is one, and hiding that would be worse.
export const DEV_USER_ID = isProduction
  ? ''
  : process.env.NEXT_PUBLIC_LOCAL_DEV_USER_ID || process.env.NEXT_PUBLIC_STAGE_DEV_USER_ID || '';
export const DEV_SECRET_KEY = isProduction
  ? ''
  : process.env.NEXT_PUBLIC_LOCAL_DEV_SECRET_KEY || process.env.NEXT_PUBLIC_STAGE_DEV_SECRET_KEY || '';

// Privy. When the app id is set the app mounts Privy and uses email-OTP + the embedded Solana wallet.
export const PRIVY_APP_ID = E.privyAppId ?? '';
export const PRIVY_CLIENT_ID = E.privyClientId ?? '';
export const USE_PRIVY = PRIVY_APP_ID.length > 0;

// The marketing site. Invite links point HERE, not at the app origin: the landing page reads `?ref=`,
// attributes the f-list signup, and relays the handle on to the app — so a fren who isn't ready to
// sign up still lands somewhere that explains what fpay is. Also the f-list exit from the invite gate.
export const LANDING_URL = (E.landingUrl || 'https://frenspay.xyz').replace(/\/$/, '');

// Dev-only build flag: true under `next dev` (yarn web), false in a production build. Gates testing
// affordances (e.g. the Settings "Reset for testing" action) so they never ship to a prod bundle.
export const IS_DEV = !isProduction;
