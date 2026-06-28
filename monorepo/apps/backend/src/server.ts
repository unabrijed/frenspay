import cors from '@fastify/cors';
import Fastify from 'fastify';

import { config } from './config';
import { hasDatabase } from './db/pool';
import { registerRoutes } from './routes/index';
import { startConfirmer } from './services/confirmer';
import { startFxRefresher } from './services/fxRate';
import { registerHeliusWebhook } from './services/helius';
import { metrics } from './services/metrics';
import { startRateLimitSweeper } from './services/rateLimit';

async function start() {
  // trustProxy: behind Railway's proxy, so req.ip reflects the client (used as a rate-limit fallback key).
  const app = Fastify({ logger: true, trustProxy: true });

  const corsOrigin = config.corsOrigin ? config.corsOrigin.split(',').map((s) => s.trim()) : true;
  await app.register(cors, { origin: corsOrigin });

  // M6 observability: count requests by outcome + log route/status/latency (pino, already structured).
  app.addHook('onResponse', async (req, reply) => {
    metrics.inc('http_requests');
    metrics.inc(reply.statusCode < 400 ? 'http_ok' : 'http_err');
    req.log.info({ method: req.method, url: req.url, status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'req');
  });
  app.addHook('onError', async (_req, _reply, err) => {
    metrics.inc('errors');
    app.log.error({ err }, 'request error');
  });

  app.get('/health', async () => ({ status: 'ok', database: hasDatabase() ? 'configured' : 'none' }));

  await registerRoutes(app);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Pay backend listening on :${config.port}`);

  // M2: poll pending transfers to confirmation (no-op without DB + USDC_MINT).
  startConfirmer(8000, (m) => app.log.info(m));

  // M6: sweep stale rate-limit windows independently of the confirmer (which no-ops without a mint).
  startRateLimitSweeper();

  // M7: prime + refresh the live FX rate in the background (quoting reads the cache; falls back safely).
  startFxRefresher(config.fxRefreshMs, (m) => app.log.info(m));

  // Indexer: register the Helius push webhook (no-op unless HELIUS_API_KEY + PUBLIC_BASE_URL set).
  void registerHeliusWebhook((m) => app.log.info(m));
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
