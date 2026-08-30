// notifications.ts — M6 in-app inbox.
import type { FastifyInstance } from 'fastify';

import type { NotificationsResponse, PushTokenRequest } from '@fpay/shared';

import { requireUserId } from '../auth';
import {
  deletePushTokens,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
  upsertPushToken,
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

  // The phone app's device token (0021). Registered after every sign-in — re-registering moves a
  // token to its new owner — and removed on sign-out so the next person on the phone gets no
  // stranger's pushes. Expo tokens are the only shape accepted; anything else is a client bug.
  app.post<{ Body: PushTokenRequest }>('/me/push-token', async (req, reply) => {
    const userId = requireUserId(req);
    const { token, platform } = req.body ?? ({} as PushTokenRequest);
    if (!/^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(token ?? '') || !['android', 'ios'].includes(platform)) {
      return reply.code(400).send({ error: 'invalid_push_token' });
    }
    await upsertPushToken(userId, token, platform);
    return { ok: true };
  });

  app.delete<{ Body: { token?: string } }>('/me/push-token', async (req) => {
    requireUserId(req);
    if (req.body?.token) await deletePushTokens([req.body.token]);
    return { ok: true };
  });
}
