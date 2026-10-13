import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../envConfig';

const newMoneyIntents = new Set([
  '/orders/quote', '/orders', '/transfer/prepare', '/crosschain/prepare',
  '/crosschain/deposit-prepare', '/crosschain/deposit', '/merchant-payments/prepare',
  '/merchant-payments/:id/actions', '/merchant-payments/:id/confirm',
]);
/** Existing signed-transfer submission and reconciliation remain recovery operations. */
export async function enforceSimulationMode(req: FastifyRequest, reply: FastifyReply) {
  if (config.customerPaymentMode === 'simulation' && req.method === 'POST' &&
      newMoneyIntents.has(req.routeOptions.url ?? req.url.split('?')[0]))
    return reply.code(409).send({ error: 'simulation_only' });
}

const windows = new Map<string, { until: number; count: number }>();
export function limitCampaign(did: string) {
  const now = Date.now();
  if (windows.size > 10000) for (const [id, w] of windows) if (w.until <= now) windows.delete(id);
  const current = windows.get(did);
  if (!current || current.until <= now) { windows.set(did, { until: now + 60000, count: 1 }); return; }
  if (++current.count > 30) throw Object.assign(new Error('rate_limited'), { statusCode: 429 });
}
