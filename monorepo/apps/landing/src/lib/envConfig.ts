// envConfig.ts — the ONE place landing env is read. Same tier convention as apps/web and
// apps/admin (see apps/web/src/services/envConfig.ts for the full rationale): Next inlines
// `process.env.NEXT_PUBLIC_*` as STATIC literals at build time and forces NODE_ENV, so the tier
// comes from NEXT_PUBLIC_APP_ENV, not NODE_ENV:
//   local (default under `next dev`)      → NEXT_PUBLIC_LOCAL_<KEY> → NEXT_PUBLIC_STAGE_<KEY>
//   stage (a stage deploy sets APP_ENV)   → NEXT_PUBLIC_STAGE_<KEY>
//   production (default in a build)       → NEXT_PUBLIC_<KEY>
//
// The tier block below is asserted identical across all four apps by `yarn check:env`. It cannot be
// imported from @fpay/shared: Next only inlines LITERAL process.env references appearing in the
// app's own source, so a shared reader would resolve to undefined at runtime.
//
// Landing is statically exported, so every value here is baked in at build time.
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
  appUrl: pick(
    process.env.NEXT_PUBLIC_LOCAL_APP_URL,
    process.env.NEXT_PUBLIC_STAGE_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ),
  apiUrl: pick(
    process.env.NEXT_PUBLIC_LOCAL_API_URL,
    process.env.NEXT_PUBLIC_STAGE_API_URL,
    process.env.NEXT_PUBLIC_API_URL,
  ),
};

// Where the f-list form posts. Previously read the BARE name with no tier chain, so a stage deploy
// (which only sets NEXT_PUBLIC_STAGE_API_URL) fell through to localhost and every signup was lost.
export const API_URL = (E.apiUrl || 'http://localhost:3001').replace(/\/$/, '');

// Signup hands off to email OTP in the customer app. Stage must name its own app origin.
export const APP_URL = (E.appUrl || (APP_ENV === 'local' ? 'http://localhost:3000' : 'https://app.frenspay.xyz')).replace(/\/$/, '');
