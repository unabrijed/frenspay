// envConfig.ts — the ONE place LP-console env is read. Next inlines `process.env.NEXT_PUBLIC_*` as
// STATIC literals + forces NODE_ENV (development in `next dev`, production in a build), so NODE_ENV
// can never carry 'stage'. The tier therefore comes from NEXT_PUBLIC_APP_ENV:
//   local (default under `next dev`)      → NEXT_PUBLIC_LOCAL_<KEY> → NEXT_PUBLIC_STAGE_<KEY>
//   stage (a stage deploy sets APP_ENV)   → NEXT_PUBLIC_STAGE_<KEY>
//   production (default in a build)       → NEXT_PUBLIC_<KEY>
// Bare NEXT_PUBLIC_* names exist ONLY in production builds/hosts — dev tiers never read them.
//
// The tier block below is a byte-identical copy of apps/web's, which is the reference
// implementation; `yarn check:env` asserts every Next app carries the same one. It deliberately is
// NOT imported from @fpay/shared: Next only inlines LITERAL process.env references appearing in the
// app's own source, so a shared reader would resolve to undefined at runtime.
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
  throw new Error(`NEXT_PUBLIC_APP_ENV must be local | stage | production — got ${JSON.stringify(APP_ENV)}`);
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

const DEFAULT_API_URL = 'http://localhost:3001';
export const API_URL = E.apiUrl || DEFAULT_API_URL;

// Deployed tiers fail CLOSED to mainnet, matching apps/web: a missing RPC var must never resurrect
// devnet affordances on a live site. Only local dev defaults to devnet.
export const SOLANA_RPC_URL =
  E.solanaRpcUrl ||
  (isProdEnv || isStageEnv ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
export const IS_MAINNET = !SOLANA_RPC_URL.includes('devnet');

// Dev-only backend identity (no Privy). Read inside the `isProduction` ternary, not in `E`, so the
// whole branch folds away in a production build — the same rule apps/web documents at length for
// its dev signing key. This console has no dev SECRET key at all: an LP signs with Privy or not at
// all, and there is nothing here worth the risk of a raw key in a bundle.
export const DEV_USER_ID = isProduction
  ? ''
  : process.env.NEXT_PUBLIC_LOCAL_DEV_USER_ID || process.env.NEXT_PUBLIC_STAGE_DEV_USER_ID || '';

// Privy. When the app id is set the console mounts Privy and uses email-OTP + the embedded Solana
// wallet — which the LP genuinely needs, because staking signs a real USDC transfer.
export const PRIVY_APP_ID = E.privyAppId ?? '';
export const PRIVY_CLIENT_ID = E.privyClientId ?? '';
export const USE_PRIVY = PRIVY_APP_ID.length > 0;

export const IS_DEV = !isProduction;
