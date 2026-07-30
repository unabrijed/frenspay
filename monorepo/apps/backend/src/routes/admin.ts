// admin.ts — read-only flow visibility for the operator (role='admin'). What happened where:
// every order across every user, the full per-order record (events + routing + dispute +
// escrow legs), and an overview of everything currently needing a human. Actions deliberately
// stay on the dev /sim routes — this surface only observes.
import type { FastifyInstance } from 'fastify';

import type { AdminOrderDetailResponse, AdminOrdersResponse, AdminOverviewResponse } from '@fpay/shared';

import { requireAdmin } from '../auth';
import {
  adminOverview,
  getDisputeForOrder,
  getOrderAdmin,
  listOrdersAdmin,
  listOrderTransfersAdmin,
  listRoutingAttemptsAdmin,
} from '../db/queries';

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get('/admin/overview', async (req): Promise<AdminOverviewResponse> => {
    await requireAdmin(req);
    return adminOverview();
  });

  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/admin/orders',
    async (req): Promise<AdminOrdersResponse> => {
      await requireAdmin(req);
      const page = await listOrdersAdmin(Number(req.query.limit ?? 50), req.query.cursor);
      return { orders: page.items, nextCursor: page.nextCursor };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/admin/orders/:id',
    async (req, reply): Promise<AdminOrderDetailResponse | undefined> => {
      await requireAdmin(req);
      const order = await getOrderAdmin(req.params.id);
      if (!order) return reply.code(404).send({ error: 'order_not_found' });
      const [routingAttempts, dispute, transfers] = await Promise.all([
        listRoutingAttemptsAdmin(order.id),
        getDisputeForOrder(order.id),
        listOrderTransfersAdmin(order.id),
      ]);
      return { order, routingAttempts, dispute, transfers };
    },
  );
}
