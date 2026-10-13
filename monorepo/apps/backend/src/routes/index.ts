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
import { registerGroupRoutes } from './groups';
import { registerExpenseRoutes } from './expenses';
import { registerFriendRoutes } from './friends';
import { registerKycRoutes } from './kyc';
import { registerMerchantRoutes } from './merchant';
import { registerMerchantPaymentRoutes } from './merchantPayments';
import { registerMoneyRoutes } from './money';
import { registerNotificationRoutes } from './notifications';
import { registerOrderRoutes } from './orders';
import { registerSystemRoutes } from './system';
import { registerWaitlistRoutes } from './waitlist';
import { registerWebhookRoutes } from './webhooks';
import { registerStraitsxSandboxWebhook } from './straitsxSandboxWebhook';
import { registerPrelaunchRoutes, registerPrelaunchAdminRoutes } from './prelaunch';
import { registerFlistRoutes } from './flist';
import { requireFlist } from '../services/flist';
import { registerCampaignRoutes, registerCampaignAdminRoutes } from './campaign';
import { enforceSimulationMode } from '../services/campaign/policy';

export async function registerRoutes(app: FastifyInstance) {
  // M6: rate-limit the sensitive routes (money movement + faucet + auth + directory) first.
  app.addHook('onRequest', rateLimitHook());

  // Identity: Privy bearer token in prod; x-dev-user-id shim when Privy is unconfigured.
  app.addHook('preHandler', authPreHandler);
  app.addHook('preHandler', enforceSimulationMode);

  await registerSystemRoutes(app);
  await registerAuthRoutes(app);
  await registerFlistRoutes(app);
  // Encapsulation keeps customer access checks off LP, admin, webhooks and public signup.
  await app.register(async (customer) => {
    customer.addHook('preHandler', requireFlist);
    await registerCampaignRoutes(customer);
    await registerPrelaunchRoutes(customer);
    await registerMoneyRoutes(customer);
    await registerMerchantPaymentRoutes(customer);
    await registerGroupRoutes(customer);
    await registerExpenseRoutes(customer);
    await registerFriendRoutes(customer);
    // Every tier is mainnet on both sides (no Sepolia table any more), so cross-chain registers
    // everywhere; the routes themselves 503 `crosschain_unavailable` until the EVM minter + RPCs exist.
    await registerCrosschainRoutes(customer);
    await registerOrderRoutes(customer);
    await registerNotificationRoutes(customer);
  });
  await registerMerchantRoutes(app);
  await registerKycRoutes(app);
  await registerWebhookRoutes(app);
  await registerStraitsxSandboxWebhook(app, config.straitsxSandboxSigningSecret);
  await registerWaitlistRoutes(app);
  await registerAdminRoutes(app);
  await registerPrelaunchAdminRoutes(app);
  await registerCampaignAdminRoutes(app);
}
