// system.ts — operational endpoints (no auth, no PII).
import type { FastifyInstance } from 'fastify';

import { getMidRate, getMidRateAsOf } from '../services/fxRate';
import { metrics } from '../services/metrics';

export async function registerSystemRoutes(app: FastifyInstance) {
  // M6: in-memory metrics (Prometheus text). Open by design — counters only, no PII.
  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return metrics.prometheus();
  });

  // M7: the live mid-market FX rate (for a standalone "today's rate" display; quotes carry their own).
  app.get('/fx/rate', async () => ({ rate: getMidRate(), asOf: getMidRateAsOf() }));
}
