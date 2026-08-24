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

// envConfig.ts — the ONE place backend env is read. Every app has one of these; the three Next
// apps key their tier off NEXT_PUBLIC_APP_ENV (Next forces NODE_ENV, so it can never carry
// 'stage'), while the backend is a plain Node process and keys off NODE_ENV directly. Same three
// tiers, same prefix rule, so `NODE_ENV=production` is the single switch that takes the whole
// system live — including which chains are real (see services/bridge/cctp/constants.ts EVM_CHAINS).
//
// NODE_ENV picks the tier; each tier reads its prefixed vars DIRECTLY from .env:
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

/** Strip whitespace and one layer of wrapping quotes. A value pasted into a host's variable panel
 *  (Railway, Vercel) routinely carries a trailing newline or the quotes it was copied inside, and
 *  neither is visible in the UI. Untrimmed, it passes every set-but-empty check, boots the server
 *  "healthy", then ships a subtly wrong header to the vendor forever — a stage `x-api-key` with a
 *  trailing newline is indistinguishable in our logs from a revoked key (the vendor answers 401 to both).
 *  Guard once here so every secret inherits it, not at each call site. */
function clean(v: string | undefined): string {
  return (v ?? '')
    .trim()
    .replace(/^(['"])(.*)\1$/s, '$2')
    .trim();
}

/** Read an env var through the tier chain (see header). */
function env(key: string, fallback = ''): string {
  const raw = isLocal
    ? process.env[`LOCAL_${key}`] || process.env[`STAGE_${key}`]
    : isStage
      ? process.env[`STAGE_${key}`]
      : process.env[key];
  return clean(raw) || fallback;
}

/** Which concrete var name `env(key)` resolved from (for boot visibility only). */
function envSource(key: string): string {
  if (isLocal && process.env[`LOCAL_${key}`]) return `LOCAL_${key}`;
  if (isDevelopment) return `STAGE_${key}`;
  return key;
}

/** Read a numeric env var, returning `def` if it's missing / non-finite / outside [min,max]. Prevents a
 *  malformed value from seeding NaN into money math (e.g. the FX fallback rate → poisoned quotes).
 *  Discarding an EXPLICITLY-set value warns at boot — "configured but silently ignored" cost us a
 *  prism round to spot (an IDR-magnitude FX_FALLBACK_RATE booted clean and quoted at the default). */
function num(key: string, def: number, range?: { min?: number; max?: number }): number {
  const n = Number(env(key, String(def)));
  if (!Number.isFinite(n) || (range?.min != null && n < range.min) || (range?.max != null && n > range.max)) {
    if (env(key) !== '') console.warn(`[env] ${envSource(key)}=${env(key)} is invalid/out-of-range — using ${def}`);
    return def;
  }
  return n;
}

// Circle's canonical mainnet USDC mint. Money-realness derives from the MINT, not NODE_ENV:
// `isMainnet` hard-gates the faucet, the /sim order routes, order creation (until the escrow
// program deploys to mainnet), and cross-chain — so no tier's dev conveniences can touch real funds
// even on a stage backend pointed at mainnet.
const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const usdcMintValue = env('USDC_MINT');

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
  // Fee-payer secret as a JSON array of bytes (solana-keygen format) — parseSecretKey rejects
  // base58, so a base58 key here fails at first use.
  feePayerSecretKey: env('FEE_PAYER_SECRET_KEY'),
  // On-chain escrow program id (M2). Defaults to the deployed devnet program; the order machine
  // builds deposit/release/refund instructions against it. Falls back to the IDL's address if unset.
  escrowProgramId: env('ESCROW_PROGRAM_ID'),
  // SPL mint used as "USDC" (Circle's devnet USDC in dev; Circle's mainnet mint = real money).
  usdcMint: usdcMintValue,
  // TRUE ⇒ this backend moves real USDC, whatever NODE_ENV says. The gates above key off this.
  isMainnet: usdcMintValue === MAINNET_USDC_MINT,
  // (The platform's cut is no longer configured here: it's a flat $0.001 per conversion, a
  // constant in quoteEngine.ts — decided 2026-08-13, docs/05. PLATFORM_FEE_BPS is retired.)
  // Where merchant/LP stake (their bond — skin in the game) is held. PUBLIC KEY ONLY: nothing in
  // this design ever signs FROM the vault — deposits are user-signed and slashing is a bond
  // decrement, so the platform keeps the USDC. Deliberately NOT the fee-payer's ATA, which doubles
  // as the faucet treasury (sendUsdcFromTreasury) and would hand merchant stake out as faucet
  // inventory. Add a secret key here only when merchants can offboard and withdraw.
  stakeTreasuryAddress: env('STAKE_TREASURY_ADDRESS'),
  // Shared secret for the Helius webhook — registered as Helius' `authHeader`, so it arrives in the
  // Authorization header rather than the URL. Open in dev if unset.
  heliusWebhookSecret: env('HELIUS_WEBHOOK_SECRET'),
  // Public base URL of this backend (e.g. https://api.pay.app) — needed to register the Helius
  // webhook callback. Unset locally → registration is skipped and the poller confirms transfers.
  publicBaseUrl: env('PUBLIC_BASE_URL'),
  // Public base URL of the WEB (payer) app. No consumer since alert deep links moved to lpBaseUrl
  // — kept because deleting a deployed var name mid-flight is its own change; retire deliberately.
  webBaseUrl: env('WEB_BASE_URL'),
  // Telegram bot token for LP order alerts (services/alert/telegram.ts) AND the LP bot
  // (services/telegram). Unset → both are inert and LPs fall back to the in-app inbox, exactly
  // like an unconfigured Resend key.
  telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
  // Shared secret Telegram echoes back in X-Telegram-Bot-Api-Secret-Token on every webhook call.
  // /webhooks/telegram FAILS CLOSED without it (unlike Helius, which has the poller as fallback —
  // the bot has no fallback client, so an open webhook would mean spoofable LP actions).
  telegramWebhookSecret: env('TELEGRAM_WEBHOOK_SECRET'),
  // May the LOCAL long-poller run? envSource() can't answer this — it reports the var NAME, not
  // whether the value was inherited from STAGE_ through env()'s fallback chain — and a local
  // poller on stage's bot token would consume stage's updates. Raw process.env reads stay in this
  // file (the one place allowed to): explicit LOCAL_ token, and never the same token stage uses.
  telegramLongPollEnabled:
    isLocal &&
    !!clean(process.env.LOCAL_TELEGRAM_BOT_TOKEN) &&
    clean(process.env.LOCAL_TELEGRAM_BOT_TOKEN) !== clean(process.env.STAGE_TELEGRAM_BOT_TOKEN),
  // Public base URL of the LP console (provider.frenspay.xyz) — where alert deep links and the
  // bot's "Open console" buttons land. Distinct from webBaseUrl (the payer app): LP alerts pointed
  // there deep-linked at /merchant/... paths that no longer exist. Unset → alerts still send, they
  // just carry no button.
  lpBaseUrl: env('LP_BASE_URL'),

  // Privy (M3).
  privyAppId: env('PRIVY_APP_ID'),
  privyAppSecret: env('PRIVY_APP_SECRET'),
  // Optional: paste the verification key from the Privy dashboard to skip a network fetch per verify.
  privyVerificationKey: env('PRIVY_VERIFICATION_KEY'),

  // M7: KYC vendor. 'sim' = the dev instant-promote (no documents); 'persona' = real document+selfie
  // via Persona's hosted flow, decisions read back by the reconciler poller. NODE_ENV decides:
  // local → sim, stage/prod → persona (prod must never self-promote). Override per tier via
  // <PREFIX>_KYC_PROVIDER if needed. A persona_sandbox_ key is refused outside dev/stage (assertKycConfig).
  kycProvider: env('KYC_PROVIDER', isLocal ? 'sim' : 'persona'),
  personaApiKey: env('PERSONA_API_KEY'),
  personaTemplateId: env('PERSONA_TEMPLATE_ID'),
  personaBaseUrl: env('PERSONA_BASE_URL', 'https://api.withpersona.com'),

  // Pay-by-phone OTP (services/phoneOtp.ts). 'console' = the code goes to the server log (local
  // only; refused on production); 'messagecentral' = Message Central VerifyNow. Stage/prod default
  // to messagecentral and merely warn when the key is unset — enrollment 502s, nothing else does.
  phoneOtpProvider: env('PHONE_OTP_PROVIDER', isLocal ? 'console' : 'messagecentral'),
  messageCentralCustomerId: env('MESSAGECENTRAL_CUSTOMER_ID'),
  messageCentralKey: env('MESSAGECENTRAL_KEY'),

  // v2 cross-chain (docs/19): per-EVM-chain RPCs (Sepolias on dev/stage, mainnets in prod).
  ethereumRpcUrl: env('ETHEREUM_RPC_URL'),
  baseRpcUrl: env('BASE_RPC_URL'),
  arbitrumRpcUrl: env('ARBITRUM_RPC_URL'),
  // Platform EVM signer for the settle (mint) leg — 0x-hex private key, one key for all chains.
  evmMinterPrivateKey: env('EVM_MINTER_PRIVATE_KEY'),
  // Circle Iris attestation API; tier default keeps staging on the sandbox.
  irisApiUrl: env('IRIS_API_URL', isProduction ? 'https://iris-api.circle.com' : 'https://iris-api-sandbox.circle.com'),
  // Our per-destination fee (dollars) ON TOP of protocol costs. Absorb L2 cents, pass through L1.
  cctpFeeUsd: {
    ethereum: num('CCTP_FEE_USD_ETHEREUM', 2, { min: 0, max: 50 }),
    base: num('CCTP_FEE_USD_BASE', 0, { min: 0, max: 50 }),
    arbitrum: num('CCTP_FEE_USD_ARBITRUM', 0, { min: 0, max: 50 }),
  } as Record<string, number>,
  cctpInFeeUsd: {
    ethereum: num('CCTP_IN_FEE_USD_ETHEREUM', 2, { min: 0, max: 50 }),
    base: num('CCTP_IN_FEE_USD_BASE', 0, { min: 0, max: 50 }),
    arbitrum: num('CCTP_IN_FEE_USD_ARBITRUM', 0, { min: 0, max: 50 }),
  } as Record<string, number>,
  // Which rail serves each direction (the protocol-mix knobs; see services/bridge/registry.ts).
  bridgeRailOut: env('BRIDGE_RAIL_OUT', 'cctp_standard'),
  bridgeRailIn: env('BRIDGE_RAIL_IN', 'cctp_fast'),

  // M7 live FX, per-currency since the Indonesia corridor. A free, no-key source returning a full
  // `rates` map; cached + range-validated per currency, falling back to these on any failure.
  // Refreshed in the background so quoting never blocks on the network.
  fxSourceUrl: env('FX_SOURCE_URL', 'https://open.er-api.com/v6/latest/USD'),
  // Validated per currency: a bad fallback must never seed NaN into a quote (NaN comparisons
  // silently pass the cash-out cap), and each band matches services/fxRate.ts FX_BANDS — a single
  // validator can't hold both INR (~95) and IDR (~17,900). Bad refresh interval can't become a hot
  // loop (floored). The source updates once a day, so 6h is already generous.
  fxFallbackRates: {
    INR: num('FX_FALLBACK_RATE', 87.55, { min: 50, max: 150 }),
    IDR: num('FX_FALLBACK_RATE_IDR', 16_500, { min: 12_000, max: 25_000 }),
  } as Record<string, number>,
  fxRefreshMs: num('FX_REFRESH_MS', 21_600_000, { min: 1000 }), // 6h default

  // Payout providers (docs/23). Rows in `payout_providers` are routing metadata; THESE are the
  // credentials, keyed by provider row id — the cctpFeeUsd pattern: statically enumerated so the
  // env↔code grep link survives, dynamically looked up by id. An id absent (or placeholder) here
  // makes its row inert: a DB row is never sufficient to move money (project-model invariant 11).
  // TEST MODE ONLY — live keys are a licensing/counsel decision (docs/11), not an env change.
  // XENDIT_SECRET_KEY/XENDIT_CALLBACK_TOKEN stay as fallbacks for xendit_id (the fxFallbackRates
  // precedent: tolerate the deployed name rather than renaming a live var).
  xenditApiUrl: env('XENDIT_API_URL', 'https://api.xendit.co'),
  payoutSecretKeys: {
    xendit_id: env('XENDIT_ID_SECRET_KEY') || env('XENDIT_SECRET_KEY'),
  } as Record<string, string>,
  // Per-provider token the vendor echoes in x-callback-token on /webhooks/xendit/:providerId;
  // unset = that provider's webhook is rejected (the poller stays authoritative).
  payoutCallbackTokens: {
    xendit_id: env('XENDIT_ID_CALLBACK_TOKEN') || env('XENDIT_CALLBACK_TOKEN'),
  } as Record<string, string>,
  // Release destination seeded into provider-model platform merchant rows (docs/23). PUBLIC KEY
  // ONLY — nothing signs from it — but unlike the stake treasury it IS a release target, so it's
  // parse-validated at boot (assertPayoutConfig): in the provider model the fiat leaves first, and
  // a typo'd-but-valid address would burn escrow after real money moved. Unset locally = the seed
  // derives a deterministic devnet key.
  platformTreasuryAddress: env('PLATFORM_TREASURY_ADDRESS'),

  // Landing f list: transactional email (Resend REST — no SDK, see services/email.ts) plus the HMAC
  // key that mints share codes and confirm tokens. BOTH unset is the safe default: no codes are
  // minted and no mail is sent, and /waitlist still accepts signups exactly as it did before. That
  // is deliberate — this must be deployable before the DNS records and API key exist.
  resendApiKey: env('RESEND_API_KEY'),
  emailFrom: env('EMAIL_FROM', 'fpay <frens@frenspay.xyz>'),
  waitlistSecret: env('WAITLIST_SECRET'),
  // Where the confirm link bounces the browser back to — the marketing site, not this API.
  landingUrl: env('LANDING_URL', 'https://frenspay.xyz'),

  // Root admins: comma-separated Privy login addresses that are admin no matter what users.role
  // says, and that the console cannot demote. Everyone else is granted/revoked from the UI. This
  // exists so a bad demote can't lock every operator out of the console — the recovery path is an
  // env var, not a psql session. Matched against the PRIVY-VERIFIED address stored on users.email.
  adminEmails: (env('ADMIN_EMAILS', '') || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
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
// No root admin named = nobody can reach the console except an already-granted users.role, and the
// documented lockout recovery does not exist. Silent until now, and the tier prefix is the easy way
// to get it wrong: a bare ADMIN_EMAILS on a stage host is invisible, and STAGE_ADMIN_EMAILS on prod
// is too. Name the variable actually being read so a mis-prefixed one is obvious.
if (config.adminEmails.length === 0) {
  console.warn(
    `[config] WARNING: ${envSource('ADMIN_EMAILS')} is unset — no root admins. The admin console is ` +
      "reachable only by a user whose users.role is already 'admin'.",
  );
}
// The f-list loop needs both halves: the key to send and the secret to mint a token the confirm
// endpoint can verify. One without the other is a half-configured deploy, so say so at boot rather
// than silently dropping every confirm mail.
if (config.resendApiKey && !config.waitlistSecret) {
  console.warn(
    '[config] WARNING: RESEND_API_KEY is set but WAITLIST_SECRET is not — f-list confirm emails ' +
      'stay disabled (a token minted with no secret could be forged). Set both to enable them.',
  );
}
