import cors from '@fastify/cors';
import Fastify from 'fastify';

import { config } from './config';
import { hasDatabase } from './db/pool';
import { registerRoutes } from './routes/index';
import { startConfirmer } from './services/confirmer';
import { registerHeliusWebhook } from './services/helius';

async function start() {
  const app = Fastify({ logger: true });

  const corsOrigin = config.corsOrigin ? config.corsOrigin.split(',').map((s) => s.trim()) : true;
  await app.register(cors, { origin: corsOrigin });

  app.get('/health', async () => ({ status: 'ok', database: hasDatabase() ? 'configured' : 'none' }));

  await registerRoutes(app);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Pay backend listening on :${config.port}`);

  // M2: poll pending transfers to confirmation (no-op without DB + USDC_MINT).
  startConfirmer(8000, (m) => app.log.info(m));

  // Indexer: register the Helius push webhook (no-op unless HELIUS_API_KEY + PUBLIC_BASE_URL set).
  void registerHeliusWebhook((m) => app.log.info(m));
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
