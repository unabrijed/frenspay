// Route registrar — handlers live in domain modules (system/auth/money/orders/kyc/notifications/
// webhooks). Cross-cutting hooks attach HERE, before any module registers, so every route sees the
// identical middleware order: rate limit → auth.
import type { FastifyInstance } from 'fastify';

import { authPreHandler } from '../auth';
import { rateLimitHook } from '../services/rateLimit';

import { registerAuthRoutes } from './auth';
import { registerKycRoutes } from './kyc';
import { registerMoneyRoutes } from './money';
import { registerNotificationRoutes } from './notifications';
import { registerOrderRoutes } from './orders';
import { registerSystemRoutes } from './system';
import { registerWebhookRoutes } from './webhooks';

export async function registerRoutes(app: FastifyInstance) {
  // M6: rate-limit the sensitive routes (money movement + faucet + auth + directory) first.
  app.addHook('onRequest', rateLimitHook());

  // Identity: Privy bearer token in prod; x-dev-user-id shim when Privy is unconfigured.
  app.addHook('preHandler', authPreHandler);

  await registerSystemRoutes(app);
  await registerAuthRoutes(app);
  await registerMoneyRoutes(app);
  await registerOrderRoutes(app);
  await registerKycRoutes(app);
  await registerNotificationRoutes(app);
  await registerWebhookRoutes(app);
}
