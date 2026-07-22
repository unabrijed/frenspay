// notifications.ts — M6 in-app inbox.
import type { FastifyInstance } from 'fastify';

import type { NotificationsResponse } from '@fpay/shared';

import { requireUserId } from '../auth';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from '../db/queries';

export async function registerNotificationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string; cursor?: string } }>('/notifications', async (req) => {
    const userId = requireUserId(req);
    const [page, unread] = await Promise.all([
      listNotifications(userId, Number(req.query.limit ?? 30), req.query.cursor),
      unreadNotificationCount(userId),
    ]);
    return { notifications: page.items, unread, nextCursor: page.nextCursor } satisfies NotificationsResponse;
  });

  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (req, reply) => {
    const userId = requireUserId(req);
    const ok = await markNotificationRead(req.params.id, userId);
    if (!ok) return reply.code(404).send({ error: 'notification_not_found' });
    return { ok: true };
  });

  app.post('/notifications/read-all', async (req) => {
    const userId = requireUserId(req);
    await markAllNotificationsRead(userId);
    return { ok: true };
  });
}
