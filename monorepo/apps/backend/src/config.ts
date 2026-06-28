import 'dotenv/config';

// Env config — the ONE place backend env is read. NODE_ENV decides where each value comes from:
//   local / development / stage  → isDevelopment → STAGE_<KEY> (falling back to <KEY>)
//   production                   → <KEY>  (unprefixed)
// So development + stage share one set of STAGE_* values; production uses the bare names. Every
// backend env read must go through `config`.
export enum Environment {
  LOCAL = 'local',
  DEVELOPMENT = 'development',
  STAGE = 'stage',
  PRODUCTION = 'production',
}

const node_env = (process.env.NODE_ENV ?? Environment.DEVELOPMENT).toLowerCase();
const isStaging = node_env === Environment.STAGE;
const isLocal = node_env === Environment.LOCAL || node_env === Environment.DEVELOPMENT;
const isDevelopment = isStaging || isLocal;

/** Read an env var: dev/stage prefer STAGE_<KEY> then fall back to <KEY>; production uses <KEY>. */
function env(key: string, fallback = ''): string {
  if (isDevelopment) return process.env[`STAGE_${key}`] || process.env[key] || fallback;
  return process.env[key] || fallback;
}

export const config = {
  nodeEnv: node_env,
  isDevelopment,
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

  // M7: live FX. A free, no-key source returning `rates.INR`; cached + range-validated, falling back to
  // FX_FALLBACK_RATE on any failure. Refreshed in the background so quoting never blocks on the network.
  fxSourceUrl: env('FX_SOURCE_URL', 'https://open.er-api.com/v6/latest/USD'),
  fxFallbackRate: Number(env('FX_FALLBACK_RATE', '87.55')),
  fxRefreshMs: Number(env('FX_REFRESH_MS', '600000')), // 10 min
};
