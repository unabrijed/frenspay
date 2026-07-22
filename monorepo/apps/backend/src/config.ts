import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load this app's own .env first (works from any cwd — a stray root .env must not shadow it),
// falling back to cwd/.env for non-standard launches.
const envPath = [
  resolve(import.meta.dirname ?? process.cwd(), '../.env'),
  resolve(process.cwd(), '.env'),
].find((p) => existsSync(p));
if (envPath) loadDotenv({ path: envPath });

// Env config — the ONE place backend env is read. NODE_ENV picks the tier; each tier reads its
// prefixed vars DIRECTLY from .env:
//   local / development  → LOCAL_<KEY> → STAGE_<KEY>   (LOCAL_ overrides what differs — DB, CORS;
//                          everything else deliberately shares the STAGE_ values)
//   stage                → STAGE_<KEY>
//   production           → <KEY>  (bare names exist ONLY on the production host, never in a local
//                          file — so dev tiers never fall back to them and a stray prod var in the
//                          shell can't leak into a dev run)
// Every backend env read must go through `config`.
export enum Environment {
  LOCAL = 'local',
  DEVELOPMENT = 'development',
  STAGE = 'stage',
  PRODUCTION = 'production',
}

const node_env = (process.env.NODE_ENV ?? Environment.DEVELOPMENT).toLowerCase();
const isStage = node_env === Environment.STAGE;
const isLocal = node_env === Environment.LOCAL || node_env === Environment.DEVELOPMENT;
const isDevelopment = isStage || isLocal;
const isProduction = !isDevelopment;

/** Read an env var through the tier chain (see header). */
function env(key: string, fallback = ''): string {
  if (isLocal) return process.env[`LOCAL_${key}`] || process.env[`STAGE_${key}`] || fallback;
  if (isStage) return process.env[`STAGE_${key}`] || fallback;
  return process.env[key] || fallback;
}

/** Which concrete var name `env(key)` resolved from (for boot visibility only). */
function envSource(key: string): string {
  if (isLocal && process.env[`LOCAL_${key}`]) return `LOCAL_${key}`;
  if (isDevelopment) return `STAGE_${key}`;
  return key;
}

/** Read a numeric env var, returning `def` if it's missing / non-finite / outside [min,max]. Prevents a
 *  malformed value from seeding NaN into money math (e.g. the FX fallback rate → poisoned quotes). */
function num(key: string, def: number, range?: { min?: number; max?: number }): number {
  const n = Number(env(key, String(def)));
  if (!Number.isFinite(n) || (range?.min != null && n < range.min) || (range?.max != null && n > range.max)) {
    return def;
  }
  return n;
}

export const config = {
  nodeEnv: node_env,
  isDevelopment,
  // True only for local/development — NOT stage. Stage shares dev config values but serves real
  // (if test) users, so client-spoofable dev shims must key off this, not isDevelopment.
  isLocal,
  isStage,
  isProduction,
  // PORT is injected unprefixed by the host platform (e.g. Railway); keep it that way.
  port: Number(process.env.PORT ?? 3000),

  databaseUrl: env('DATABASE_URL'),
  // Disable SSL only for a local non-SSL Postgres (STAGE_PGSSL=disable).
  pgSslDisable: env('PGSSL') === 'disable',
  // CORS allowlist (comma-separated origins). Empty = allow all (dev).
  corsOrigin: env('CORS_ORIGIN'),

  // Solana (devnet by default; Helius RPC recommended for reliability + webhooks).
  solanaRpcUrl: env('SOLANA_RPC_URL', 'https://api.devnet.solana.com'),
  heliusApiKey: env('HELIUS_API_KEY'),
  // Fee-payer secret as a JSON array of bytes (solana-keygen format) or base58 string.
  feePayerSecretKey: env('FEE_PAYER_SECRET_KEY'),
  // On-chain escrow program id (M2). Defaults to the deployed devnet program; the order machine
  // builds deposit/release/refund instructions against it. Falls back to the IDL's address if unset.
  escrowProgramId: env('ESCROW_PROGRAM_ID'),
  // SPL mint used as "USDC" (a controlled devnet mint in dev; Circle's USDC mint in prod).
  usdcMint: env('USDC_MINT'),
  // Shared secret for the Helius webhook (?secret=...). Open in dev if unset.
  heliusWebhookSecret: env('HELIUS_WEBHOOK_SECRET'),
  // Public base URL of this backend (e.g. https://api.pay.app) — needed to register the Helius
  // webhook callback. Unset locally → registration is skipped and the poller confirms transfers.
  publicBaseUrl: env('PUBLIC_BASE_URL'),

  // Privy (M3).
  privyAppId: env('PRIVY_APP_ID'),
  privyAppSecret: env('PRIVY_APP_SECRET'),
  // Optional: paste the verification key from the Privy dashboard to skip a network fetch per verify.
  privyVerificationKey: env('PRIVY_VERIFICATION_KEY'),

  // M7: KYC vendor. 'sim' = the dev instant-promote (no documents); 'didit' = real document+liveness
  // via Didit's hosted flow + signed webhook. NODE_ENV decides: local → sim, stage/prod → didit
  // (prod must never self-promote). Override per tier via <PREFIX>_KYC_PROVIDER if needed.
  kycProvider: env('KYC_PROVIDER', isLocal ? 'sim' : 'didit'),
  diditApiKey: env('DIDIT_API_KEY'),
  diditWorkflowId: env('DIDIT_WORKFLOW_ID'),
  diditWebhookSecret: env('DIDIT_WEBHOOK_SECRET'),
  diditBaseUrl: env('DIDIT_BASE_URL', 'https://verification.didit.me'),

  // M7: live FX. A free, no-key source returning `rates.INR`; cached + range-validated, falling back to
  // FX_FALLBACK_RATE on any failure. Refreshed in the background so quoting never blocks on the network.
  fxSourceUrl: env('FX_SOURCE_URL', 'https://open.er-api.com/v6/latest/USD'),
  // Validated: a bad FX_FALLBACK_RATE must never seed NaN into a quote (NaN comparisons silently pass
  // the cash-out cap). Same plausibility band as the live-rate validator; bad refresh interval can't
  // become a hot loop (floored).
  fxFallbackRate: num('FX_FALLBACK_RATE', 87.55, { min: 50, max: 150 }),
  fxRefreshMs: num('FX_REFRESH_MS', 600_000, { min: 1000 }), // 10 min default
};

// Boot visibility: which tier + which DATABASE_URL var won (host only — never credentials).
const dbSource = envSource('DATABASE_URL');
const dbHost = (() => {
  try {
    return new URL(config.databaseUrl).host;
  } catch {
    return '(unset)';
  }
})();
console.log(`[config] env=${node_env} database=${dbSource} host=${dbHost}`);
if (isLocal && dbSource.startsWith('STAGE_')) {
  console.warn(
    `[config] WARNING: NODE_ENV=${node_env} is using the STAGE database (${dbHost}). ` +
      'Set LOCAL_DATABASE_URL to point local runs at their own Postgres.',
  );
}
