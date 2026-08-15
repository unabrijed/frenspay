// envConfig.ts — the ONE place admin env is read. Same tier convention as
// apps/web/src/services/envConfig.ts (see that file's header for the full rationale):
// NEXT_PUBLIC_APP_ENV picks the tier, Next inlines the literal process.env.NEXT_PUBLIC_* reads at
// build time.
//   local (default under `next dev`)      → NEXT_PUBLIC_LOCAL_<KEY> → NEXT_PUBLIC_STAGE_<KEY>
//   stage (a stage deploy sets APP_ENV)   → NEXT_PUBLIC_STAGE_<KEY>
//   production (default in a build)       → NEXT_PUBLIC_<KEY>
// The tier block below is asserted identical to web's and landing's by `yarn check:env`.
//
// The API host is the exception, and the reason this file differs from its siblings: admin ships as
// ONE deployment that drives EITHER backend, so both hosts are inlined and the choice is made in the
// browser. See API_HOSTS below. Everything else (Privy, the dev shim) still resolves by tier.
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

export type ApiMode = 'stage' | 'prod';

/** The two backends this console can drive. Unlike every other app here, admin has ONE deployment
 * and picks its target at RUNTIME (services/apiMode.ts) rather than at build time — so both hosts
 * are inlined and neither is "the" API_URL.
 *
 * Deliberately NOT routed through pick(): pick() resolves the production tier whenever APP_ENV is
 * unset, which would quietly make `stage` the PROD host — the one misconfiguration that must never
 * be silent. Spelled out, it fails safe instead.
 *
 * `prod` empty is a supported state, and the current one: it means prod mode cannot be selected.
 *
 * The LOCAL_ override is gated on `!isProduction` so it is dead code in any built bundle — same
 * treatment DEV_USER_ID gets below. Ungated it would outrank NEXT_PUBLIC_STAGE_API_URL in a
 * DEPLOYED build too, so one stray LOCAL_ var on the Vercel project would silently repoint the
 * stage target. Verified by building with sentinel hosts and grepping .next/static. */
export const API_HOSTS: Record<ApiMode, string> = {
  stage:
    (isProduction ? undefined : process.env.NEXT_PUBLIC_LOCAL_API_URL) ||
    process.env.NEXT_PUBLIC_STAGE_API_URL ||
    'http://localhost:3001',
  prod: process.env.NEXT_PUBLIC_API_URL || '',
};

const E = {
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

// No-Privy local dev: a seeded ADMIN user id sent as x-dev-user-id (backend dev shim).
// Gated on `!isProduction` so it is dead code a production build strips — the backend already
// refuses the header outside local (auth.ts), but a prod bundle should not advertise an admin id
// either. Same reasoning as apps/web/src/services/envConfig.ts, which gates a signing key this way.
export const DEV_USER_ID = isProduction ? '' : (E.devUserId ?? '');

// Privy. When the app id is set the console mounts Privy and uses its login; no wallets here.
export const PRIVY_APP_ID = E.privyAppId ?? '';
export const PRIVY_CLIENT_ID = E.privyClientId ?? '';
export const USE_PRIVY = PRIVY_APP_ID.length > 0;
