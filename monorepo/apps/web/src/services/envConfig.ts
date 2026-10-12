// envConfig.ts — the ONE place web env is read. Next inlines `process.env.NEXT_PUBLIC_*` as STATIC
// literals + forces NODE_ENV (development in `next dev`, production in a build), so NODE_ENV can
// never carry 'stage'. The tier therefore comes from NEXT_PUBLIC_APP_ENV:
//   local (default under `next dev`)      → NEXT_PUBLIC_LOCAL_<KEY> → NEXT_PUBLIC_STAGE_<KEY>
//   stage (a stage deploy sets APP_ENV)   → NEXT_PUBLIC_STAGE_<KEY>
//   production (default in a build)       → NEXT_PUBLIC_<KEY>
// Bare NEXT_PUBLIC_* names exist ONLY in production builds/hosts — dev tiers never read them. ONE
// exception: the Privy app is not tiered (exactly one app, every tier mounts it), so its two names are
// read bare on every tier — see the PRIVY_APP_ID export below.
//
// This file is the REFERENCE implementation of the tier block. apps/admin and apps/landing carry a
// byte-identical copy of it, asserted by `yarn check:env`. It deliberately is NOT imported from
// @fpay/shared: Next only inlines LITERAL process.env references appearing in the app's own source,
// so a shared reader would resolve to undefined at runtime. (The backend can't import it either —
// runtime value imports from @fpay/shared fail under tsx; see apps/backend/src/envConfig.ts.)
const isProduction = process.env.NODE_ENV === 'production';
// A value pasted into a host's variable panel carries baggage — a trailing newline, the quotes it was
// copied inside. The backend launders every read through clean(); this is that twin, and it matters
// more here: an untrimmed tier name matches nothing and drops to the stage chain below.
const APP_ENV = (process.env.NEXT_PUBLIC_APP_ENV || (isProduction ? 'production' : 'local'))
  .trim()
  .replace(/^(['"])([\s\S]*)\1$/, '$2');
const isProdEnv = APP_ENV === 'production';
const isStageEnv = APP_ENV === 'stage';
// An unrecognised tier used to fall out of pick() into the STAGE chain — a production build quietly
// signing in against the stage Privy app while its own bare vars sat there unread. NEXT_PUBLIC_* is
// inlined, so this folds at build time: a mistyped tier fails the build instead of shipping.
if (!isProdEnv && !isStageEnv && APP_ENV !== 'local') {
  throw new Error(`NEXT_PUBLIC_APP_ENV must be local | stage | production: got ${JSON.stringify(APP_ENV)}`);
}

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
// Retained for old imports; the customer prototype cannot be re-enabled by a stale build flag.
export const PRELAUNCH_ENABLED = false;
// Every tier is mainnet — there is no testnet (2026-08-30). The var only picks the RPC provider.
export const SOLANA_RPC_URL = E.solanaRpcUrl || 'https://api.mainnet-beta.solana.com';

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
//
// ONE Privy app, every tier — deliberately NOT routed through pick(): there is exactly one app, so
// tiering it would mean two variable names holding one value, and a stale STAGE_ twin silently
// winning over the bare name is exactly how stage kept mailing OTPs from a retired app (2026-08-31).
// Same reasoning apps/admin/src/services/envConfig.ts gives. Empty is a supported, LOUD state
// (USE_PRIVY false); there is no fallback to a prefixed name — missing beats wrong.
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';
/** Optional Privy app-client. Belongs to the app id above and to no other. */
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || '';
export const USE_PRIVY = PRIVY_APP_ID.length > 0;

// The marketing site. Invite links point HERE, not at the app origin: the landing page reads `?ref=`,
// attributes the f-list signup, and relays the handle on to the app — so a fren who isn't ready to
// sign up still lands somewhere that explains what fpay is. Also the f-list exit from the invite gate.
export const LANDING_URL = (E.landingUrl || 'https://frenspay.xyz').replace(/\/$/, '');

export const IS_LOCAL_ENV = APP_ENV === 'local';

// Dev-only build flag: true under `next dev` (yarn web), false in a production build. Gates testing
// affordances (e.g. the Settings "Reset for testing" action) so they never ship to a prod bundle.
export const IS_DEV = !isProduction;
