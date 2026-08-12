// Route registrar — handlers live in domain modules (system/auth/money/orders/kyc/notifications/
// webhooks). Cross-cutting hooks attach HERE, before any module registers, so every route sees the
// identical middleware order: rate limit → auth.
import type { FastifyInstance } from 'fastify';

import { authPreHandler } from '../auth';
import { config } from '../envConfig';
import { rateLimitHook } from '../services/rateLimit';

import { registerAdminRoutes } from './admin';
import { registerAuthRoutes } from './auth';
import { registerCrosschainRoutes } from './crosschain';
import { registerKycRoutes } from './kyc';
import { registerMerchantRoutes } from './merchant';
import { registerMoneyRoutes } from './money';
import { registerNotificationRoutes } from './notifications';
import { registerOrderRoutes } from './orders';
import { registerSystemRoutes } from './system';
import { registerWaitlistRoutes } from './waitlist';
import { registerWebhookRoutes } from './webhooks';

export async function registerRoutes(app: FastifyInstance) {
  // M6: rate-limit the sensitive routes (money movement + faucet + auth + directory) first.
  app.addHook('onRequest', rateLimitHook());

  // Identity: Privy bearer token in prod; x-dev-user-id shim when Privy is unconfigured.
  app.addHook('preHandler', authPreHandler);

  await registerSystemRoutes(app);
  await registerAuthRoutes(app);
  await registerMoneyRoutes(app);
  // Mainnet-lite: CCTP's EVM side keys off isProduction (Sepolia contracts + sandbox Iris on dev
  // tiers), so a mainnet-mint stage backend must not register cross-chain at all — mixing mainnet
  // Solana with testnet EVM strands funds. The web client already tolerates the 404s.
  if (!config.isMainnet || config.isProduction) await registerCrosschainRoutes(app);
  await registerOrderRoutes(app);
  await registerMerchantRoutes(app);
  await registerKycRoutes(app);
  await registerNotificationRoutes(app);
  await registerWebhookRoutes(app);
  await registerWaitlistRoutes(app);
  await registerAdminRoutes(app);
}
