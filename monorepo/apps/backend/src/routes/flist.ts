import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FlistResponse } from '@fpay/shared';
import { getPool } from '../db/pool';
import { joinWaitlistWithCode, verifyWaitlistEmail } from '../db/queries';
import { isFlistMember, verifiedEmail } from '../services/flist';
import { canonicalInviteCode } from '../services/invites';

export async function readFlist(email: string): Promise<FlistResponse> {
  const member = await isFlistMember(email);
  if (!member) return { email, member, invites: [] };
  const { rows } = await getPool().query<{ code: string; used: boolean }>(
    `select code, redeemed_at is not null as used from invite_codes
     where revoked_at is null and (owner_email = $1 or owner_id in (
       select id from users where email = $1 and status = 'active'
     )) order by created_at, code`, [email],
  );
  return { email, member, invites: rows };
}

export async function registerFlistRoutes(app: FastifyInstance) {
  const identity = async (req: FastifyRequest) => {
    if (!req.privyDid && !req.userId)
      throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    const email = await verifiedEmail(req);
    if (!email) throw Object.assign(new Error('verified_email_required'), { statusCode: 403 });
    return email;
  };
  app.get('/flist/me', async (req, reply) => {
    reply.header('cache-control', 'private, no-store');
    try {
      const email = await identity(req);
      const result = await readFlist(email);
      if (result.member) await verifyWaitlistEmail(email);
      return result;
    } catch (error) {
      const e = error as { statusCode?: number; message?: string };
      return reply.code(e.statusCode ?? 503).send({ error: e.statusCode ? e.message : 'flist_unavailable' });
    }
  });
  app.post<{ Body: { code?: string } }>('/flist/join', async (req, reply) => {
    try {
      const email = await identity(req);
      const code = canonicalInviteCode(req.body?.code ?? '');
      if (!code) return reply.code(400).send({ error: 'invalid_invite' });
      await joinWaitlistWithCode({ email, code });
      await verifyWaitlistEmail(email);
      return await readFlist(email);
    } catch (error) {
      const e = error as { statusCode?: number; code?: string; message?: string };
      if (e.code === 'invalid_invite') return reply.code(400).send({ error: 'invalid_invite' });
      return reply.code(e.statusCode ?? 503).send({ error: e.statusCode ? e.message : 'flist_unavailable' });
    }
  });
}
