// envConfig.ts — the ONE place admin env is read. Same tier convention as
// apps/web/src/services/envConfig.ts (see that file's header for the full rationale):
// NEXT_PUBLIC_APP_ENV picks the tier, Next inlines the literal process.env.NEXT_PUBLIC_* reads at
// build time.
//   local (default under `next dev`)      → NEXT_PUBLIC_LOCAL_<KEY> → NEXT_PUBLIC_STAGE_<KEY>
//   stage (a stage deploy sets APP_ENV)   → NEXT_PUBLIC_STAGE_<KEY>
//   production (default in a build)       → NEXT_PUBLIC_<KEY>
// The tier block below is asserted identical to web's and landing's by `yarn check:env`.
//
// The exceptions are the reason this file differs from its siblings: admin ships as ONE deployment
// that drives EITHER backend, so anything belonging to the TARGET rather than to the build is
// inlined for both and chosen in the browser — the API host (API_HOSTS) and the Privy app that mints
// its tokens (PRIVY_APP_IDS / PRIVY_CLIENT_IDS). Only the dev shim still resolves by tier.
/** A BUILT bundle (any `next build`), not the prod tier — see isProdEnv for that. Exported because
 *  it is also the line between "no Privy configured means use the dev shim" and "no Privy configured
 *  means somebody forgot a variable", which Providers.tsx has to tell apart. */
export const isProduction = process.env.NODE_ENV === 'production';
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

/** The Privy app that mints tokens for each target — the SECOND thing that is a property of the
 * backend rather than of the build, and for a harder reason than the host. Stage and prod are
 * separate Privy apps, and a token minted by one does not verify against a backend configured with
 * the other (backend services/privy.ts → verifyAuthToken). Build-time resolution therefore cannot be
 * right: whichever app id gets baked in, exactly one of the two targets rejects every token.
 *
 * Deliberately NOT routed through pick(), for precisely the reason API_HOSTS gives above. That
 * comment guarded the host against "APP_ENV unset silently resolves the production tier" and left
 * this on pick(), so the landmine simply moved: with APP_ENV unset on the deployment, the console
 * signed operators into the PROD Privy app while defaulting its API to stage, and the stage backend
 * rejected every token before any row was looked up — reported as "no profile on this environment".
 *
 * Empty is a supported state per target: PROD_AVAILABLE hides an unusable prod, and Providers.tsx
 * says so out loud for stage rather than falling back to a shim in a built bundle. */
export const PRIVY_APP_IDS: Record<ApiMode, string> = {
  stage:
    (isProduction ? undefined : process.env.NEXT_PUBLIC_LOCAL_PRIVY_APP_ID) ||
    process.env.NEXT_PUBLIC_STAGE_PRIVY_APP_ID ||
    '',
  prod: process.env.NEXT_PUBLIC_PRIVY_APP_ID || '',
};

/** Optional Privy app-clients, keyed the same way — a client id belongs to exactly one app id, so
 *  pairing them by anything other than the selected target would hand Privy a mismatched pair. */
export const PRIVY_CLIENT_IDS: Record<ApiMode, string> = {
  stage:
    (isProduction ? undefined : process.env.NEXT_PUBLIC_LOCAL_PRIVY_CLIENT_ID) ||
    process.env.NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID ||
    '',
  prod: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || '',
};

const E = {
  devUserId: pick(
    process.env.NEXT_PUBLIC_LOCAL_DEV_USER_ID,
    process.env.NEXT_PUBLIC_STAGE_DEV_USER_ID,
    process.env.NEXT_PUBLIC_DEV_USER_ID,
  ),
};

// No-Privy local dev: a seeded ADMIN user id sent as x-dev-user-id (backend dev shim).
// Gated on `!isProduction` so it is dead code a production build strips — the backend already
// refuses the header outside local (auth.ts), but a prod bundle should not advertise an admin id
// either. Same reasoning as apps/web/src/services/envConfig.ts, which gates a signing key this way.
export const DEV_USER_ID = isProduction ? '' : (E.devUserId ?? '');
