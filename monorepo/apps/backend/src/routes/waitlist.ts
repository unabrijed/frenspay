// waitlist.ts — public email capture for the landing page (the f list). Deliberately never calls
// requireUserId (same public mechanism as webhooks) and lives outside system.ts, whose surface
// documents a no-PII invariant. Abuse-bounded by the IP-keyed rate limit rule, not by auth.
// Always answers 201 — including duplicates — so the form can't leak who is already on the list.
import type { FastifyInstance } from 'fastify';

import type { WaitlistJoinRequest } from '@fpay/shared';

import { addWaitlistEmail } from '../db/queries';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function registerWaitlistRoutes(app: FastifyInstance) {
  app.post<{ Body: WaitlistJoinRequest }>('/waitlist', async (req, reply) => {
    const email = (req.body?.email ?? '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) return reply.code(400).send({ error: 'invalid_email' });
    const city = typeof req.body?.city === 'string' ? req.body.city.trim().slice(0, 64) : undefined;
    await addWaitlistEmail(email, city || undefined);
    return reply.code(201).send({ ok: true });
  });
}
