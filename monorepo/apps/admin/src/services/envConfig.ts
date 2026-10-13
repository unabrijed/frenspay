// envConfig.ts — the ONE place admin env is read. Same tier convention as
// apps/web/src/services/envConfig.ts (see that file's header for the full rationale):
// NEXT_PUBLIC_APP_ENV picks the tier, Next inlines the literal process.env.NEXT_PUBLIC_* reads at
// build time.
//   local (default under `next dev`)      → NEXT_PUBLIC_LOCAL_<KEY> → NEXT_PUBLIC_STAGE_<KEY>
//   stage (a stage deploy sets APP_ENV)   → NEXT_PUBLIC_STAGE_<KEY>
//   production (default in a build)       → NEXT_PUBLIC_<KEY>
// The tier block below is asserted identical to web's and landing's by `yarn check:env`.
//
// The exception is the reason this file differs from its siblings: admin ships as ONE deployment
// that drives EITHER backend, so the API host belongs to the TARGET rather than to the build — both
// are inlined and one is chosen in the browser (API_HOSTS). The Dynamic app is NOT per-target, and since
// 2026-08-31 not per-tier anywhere: every app reads it bare, both backends verify with the same one. Only the dev shim still resolves by tier.
/** A BUILT bundle (any `next build`), not the prod tier — see isProdEnv for that. Exported because
 *  it is also the line between "no Dynamic configured means use the dev shim" and "no Dynamic configured
 *  means somebody forgot a variable", which Providers.tsx has to tell apart. */
export const isProduction = process.env.NODE_ENV === 'production';
// A value pasted into a host's variable panel carries baggage — a trailing newline, the quotes it was
// copied inside. The backend launders every read through clean(); this is that twin, and it matters
// more here: an untrimmed tier name matches nothing and drops to the stage chain below.
const APP_ENV = (process.env.NEXT_PUBLIC_APP_ENV || (isProduction ? 'production' : 'local'))
  .trim()
  .replace(/^(['"])([\s\S]*)\1$/, '$2');
const isProdEnv = APP_ENV === 'production';
const isStageEnv = APP_ENV === 'stage';
// An unrecognised tier used to fall out of pick() into the STAGE chain — a production build quietly
// signing in against the stage Dynamic app while its own bare vars sat there unread. NEXT_PUBLIC_* is
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

/** Public Dynamic environment used by both API targets; backend verifies the same issuer. */
export const DYNAMIC_ENVIRONMENT_ID = pick(process.env.NEXT_PUBLIC_LOCAL_DYNAMIC_ENVIRONMENT_ID, process.env.NEXT_PUBLIC_STAGE_DYNAMIC_ENVIRONMENT_ID, process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID) || '4fc2a73c-1662-45eb-9257-8baa567066a6';

// Dynamic identifies clients by environment ID.
export const DYNAMIC_CLIENT_ID = ''; // No separate app-client ID with Dynamic.

const E = {
  devUserId: pick(
    process.env.NEXT_PUBLIC_LOCAL_DEV_USER_ID,
    process.env.NEXT_PUBLIC_STAGE_DEV_USER_ID,
    process.env.NEXT_PUBLIC_DEV_USER_ID,
  ),
};

// No-Dynamic local dev: a seeded ADMIN user id sent as x-dev-user-id (backend dev shim).
// Gated on `!isProduction` so it is dead code a production build strips — the backend already
// refuses the header outside local (auth.ts), but a prod bundle should not advertise an admin id
// either. Same reasoning as apps/web/src/services/envConfig.ts, which gates a signing key this way.
export const DEV_USER_ID = isProduction ? '' : (E.devUserId ?? '');
