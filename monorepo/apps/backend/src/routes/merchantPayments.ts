import type { FastifyInstance } from 'fastify';
import { requireUserId } from '../auth';
import { paymentCapabilities } from '../services/paymentPolicy';
import {
  getMerchantPayment,
  listMerchantPayments,
  merchantSigningActions,
  prepareMerchantPayment,
  submitMerchantPayment,
} from '../services/merchantPayments';

export async function registerMerchantPaymentRoutes(app: FastifyInstance) {
  await app.register(async (routes) => {
    routes.setErrorHandler((unknownError, request, reply) => {
      const error = unknownError as Error & { statusCode?: number };
      const safe = error.statusCode && error.statusCode >= 400 && error.statusCode < 500;
      if (!safe)
        request.log.warn({ route: request.routeOptions.url }, 'Merchant payment request unavailable');
      reply
        .code(safe ? error.statusCode! : 503)
        .send({ error: safe ? error.message : 'merchant_pay_unavailable' });
    });
    routes.get('/payments/capabilities', async (req) => paymentCapabilities(requireUserId(req)));
    routes.get('/merchant-payments', async (req) => ({
      payments: await listMerchantPayments(requireUserId(req)),
    }));
    routes.post<{ Body: { paymentLink: string } }>(
      '/merchant-payments/prepare',
      { bodyLimit: 8192 },
      async (req) => prepareMerchantPayment(requireUserId(req), req.body?.paymentLink),
    );
    routes.get<{ Params: { id: string } }>('/merchant-payments/:id', async (req) =>
      getMerchantPayment(requireUserId(req), req.params.id),
    );
    routes.post<{ Params: { id: string }; Body: { reviewToken: string } }>(
      '/merchant-payments/:id/actions',
      async (req) => merchantSigningActions(requireUserId(req), req.params.id, req.body?.reviewToken),
    );
    routes.post<{ Params: { id: string }; Body: { transactions: string[] } }>(
      '/merchant-payments/:id/confirm',
      { bodyLimit: 16384 },
      async (req) => submitMerchantPayment(requireUserId(req), req.params.id, req.body?.transactions),
    );
  });
}
