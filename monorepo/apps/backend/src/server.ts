import cors from '@fastify/cors';
import Fastify from 'fastify';

import { config } from './envConfig';
import { pendingMigrations } from './db/migrations';
import { hasDatabase } from './db/pool';
import { assertDatabaseTier } from './db/tier';
import { registerRoutes } from './routes/index';
import { startBridgePoller } from './services/bridge/poller';
import { startConfirmer } from './services/confirmer';
import { startFxRefresher } from './services/fxRate';
import { registerHeliusWebhook } from './services/helius';
import { assertKycConfig } from './services/kyc';
import { probePersona } from './services/kyc/persona';
import { startKycPoller } from './services/kyc/poller';
import { metrics } from './services/metrics';
import { assertPayoutConfig } from './services/payout/provider';
import { assertPhoneOtpConfig } from './services/phoneOtp';
import { startRateLimitSweeper } from './services/rateLimit';
import { startPrelaunchReceipts } from './services/prelaunch/receipts';
import { assertTelegramConfig } from './services/telegram/assert';

async function start() {
  // Fail fast on a misconfigured real KYC provider before accepting traffic.
  assertKycConfig();
  // Same for payouts: a typo'd platform treasury must not wait for the first escrow release.
  assertPayoutConfig();
  // Phone OTP: fatal only for console-on-prod; a missing SMS key just warns (enrollment is optional).
  assertPhoneOtpConfig();
  // Telegram: never fatal (a bot misconfig must not crash-loop a payments backend) — warns by name.
  assertTelegramConfig();

  // Serving another tier's data is worse than not serving at all, so this one IS fatal (0013).
  // Verify only — claiming an unstamped database belongs to db:deploy, never to a booting server.
  if (hasDatabase()) await assertDatabaseTier();

  // Warn (don't apply) on schema drift: a dev laptop must not mutate the shared stage DB at boot,
  // and a fatal boot migration on Railway would crash-loop. Hosts apply via db:deploy in the image's CMD.
  if (hasDatabase()) {
    try {
      const pending = await pendingMigrations();
      if (pending.length) {
        console.warn(
          `\n!!! ${pending.length} pending DB migration(s): ${pending.map((m) => `${m.version}_${m.name}`).join(', ')}` +
            `\n!!! Run: yarn workspace @fpay/backend db:migrate\n`,
        );
      }
    } catch (err) {
      console.warn(`migration check skipped: ${(err as Error).message}`);
    }
  }

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

  // Railway's healthcheck target — a deploy is only marked Active once this answers, which is what
  // turns a boot crash (or a failed migration, since migrations run first) into a failed deploy
  // instead of a live-but-broken API. Keep it dependency-free and always cheap.
  app.get('/health', async () => ({ status: 'ok', database: hasDatabase() ? 'configured' : 'none' }));

  await registerRoutes(app);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Pay backend listening on :${config.port}`);

  // M2: poll pending transfers to confirmation (no-op without DB + USDC_MINT).
  startConfirmer(8000, (m) => app.log.info(m));

  // v2 cross-chain: attestation + settle worker (no-op without DB + EVM minter config).
  startBridgePoller(5000, (m) => app.log.info(m));

  // M6: sweep stale rate-limit windows independently of the confirmer (which no-ops without a mint).
  startRateLimitSweeper();
  startPrelaunchReceipts(m=>app.log.info(m));

  // M7: prime + refresh the live FX rate in the background (quoting reads the cache; falls back safely).
  startFxRefresher(config.fxRefreshMs, (m) => app.log.info(m));

  // Indexer: register the Helius push webhook (no-op unless HELIUS_API_KEY + PUBLIC_BASE_URL set).
  void registerHeliusWebhook((m) => app.log.info(m));

  // M7: reconcile real-vendor KYC decisions (no-op with the sim provider). Reliable path even when
  // the webhook can't reach us locally; the webhook just makes approval instant.
  startKycPoller(15_000, (m) => app.log.info(m));
  // Boot self-check: a bad deployed Persona key shows up here, not on the first Verify click.
  void probePersona((m) => app.log.info(m));
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
