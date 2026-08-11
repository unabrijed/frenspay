// system.ts — operational endpoints (no PII; /fx/rate is the one authed route here, see below).
import type { FastifyInstance } from 'fastify';

import { requireUserId } from '../auth';
import { FX_BANDS, getMidRate, getMidRateAsOf } from '../services/fxRate';
import { metrics } from '../services/metrics';

export async function registerSystemRoutes(app: FastifyInstance) {
  // M6: in-memory metrics (Prometheus text). Open by design — counters only, no PII.
  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return metrics.prometheus();
  });

  // The live mid-market FX rate for the app's own displays (quotes carry their own). Authed on
  // purpose: the upstream source's terms forbid offering "programmatic or automatic access to
  // exchange rate data" — serving our signed-in users is our end purpose, an open re-export is a
  // rate API. `?currency=` selects the corridor (default INR); unknown currency → 400.
  app.get<{ Querystring: { currency?: string } }>('/fx/rate', async (req, reply) => {
    requireUserId(req);
    const currency = req.query?.currency ?? 'INR';
    if (!FX_BANDS[currency]) return reply.code(400).send({ error: 'unknown_currency' });
    return { currency, rate: getMidRate(currency), asOf: getMidRateAsOf(currency) };
  });
}
