import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  // CORS allowlist (comma-separated origins). Empty = allow all (dev).
  corsOrigin: process.env.CORS_ORIGIN ?? '',

  // Solana (devnet by default; Helius RPC recommended for reliability + webhooks).
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  heliusApiKey: process.env.HELIUS_API_KEY ?? '',
  // Fee-payer secret as a JSON array of bytes (solana-keygen format) or base58 string.
  feePayerSecretKey: process.env.FEE_PAYER_SECRET_KEY ?? '',
  // SPL mint used as "USDC" (a controlled devnet mint in dev; Circle's USDC mint in prod).
  usdcMint: process.env.USDC_MINT ?? '',
  // Shared secret for the Helius webhook (?secret=...). Open in dev if unset.
  heliusWebhookSecret: process.env.HELIUS_WEBHOOK_SECRET ?? '',

  // Privy (M3).
  privyAppId: process.env.PRIVY_APP_ID ?? '',
  privyAppSecret: process.env.PRIVY_APP_SECRET ?? '',
  // Optional: paste the verification key from the Privy dashboard to skip a network fetch per verify.
  privyVerificationKey: process.env.PRIVY_VERIFICATION_KEY ?? '',
};
