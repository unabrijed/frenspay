// envConfig.ts — the ONE place admin env is read. Same tier convention as
// apps/web/src/services/envConfig.ts (see that file's header for the full rationale):
// NEXT_PUBLIC_APP_ENV picks the tier, Next inlines the literal process.env.NEXT_PUBLIC_* reads at
// build time.
//   local (default under `next dev`)      → NEXT_PUBLIC_LOCAL_<KEY> → NEXT_PUBLIC_STAGE_<KEY>
//   stage (a stage deploy sets APP_ENV)   → NEXT_PUBLIC_STAGE_<KEY>
//   production (default in a build)       → NEXT_PUBLIC_<KEY>
// The tier block below is asserted identical to web's and landing's by `yarn check:env`.
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
  devUserId: pick(
    process.env.NEXT_PUBLIC_LOCAL_DEV_USER_ID,
    process.env.NEXT_PUBLIC_STAGE_DEV_USER_ID,
    process.env.NEXT_PUBLIC_DEV_USER_ID,
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

export const API_URL = E.apiUrl || 'http://localhost:3001';

// No-Privy local dev: a seeded ADMIN user id sent as x-dev-user-id (backend dev shim).
// Gated on `!isProduction` so it is dead code a production build strips — the backend already
// refuses the header outside local (auth.ts), but a prod bundle should not advertise an admin id
// either. Same reasoning as apps/web/src/services/envConfig.ts, which gates a signing key this way.
export const DEV_USER_ID = isProduction ? '' : (E.devUserId ?? '');

// Privy. When the app id is set the console mounts Privy and uses its login; no wallets here.
export const PRIVY_APP_ID = E.privyAppId ?? '';
export const PRIVY_CLIENT_ID = E.privyClientId ?? '';
export const USE_PRIVY = PRIVY_APP_ID.length > 0;
