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
};

// Where the f-list form posts. Previously read the BARE name with no tier chain, so a stage deploy
// (which only sets NEXT_PUBLIC_STAGE_API_URL) fell through to localhost and every signup was lost.
export const API_URL = (E.apiUrl || 'http://localhost:3001').replace(/\/$/, '');

// There was an APP_URL here, for handing a valid code off to the app. Gone with the handoff: a code
// is now spent joining the f list, so it has nothing left to open, and this site links to the app in
// neither direction again. `NEXT_PUBLIC_*_APP_URL` can come out of the deploy env.
