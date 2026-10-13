import type { FastifyReply, FastifyRequest } from 'fastify';
import { findUserById } from '../db/queries';
import { getPool } from '../db/pool';
import { config } from '../envConfig';
import { getLinkedEmail, privyConfigured } from './privy';

export async function isFlistMember(email: string): Promise<boolean> {
  const { rows } = await getPool().query<{ member: boolean }>(
    `select exists (
       select 1 from waitlist w join invite_codes i on i.code = w.invite_code
       where w.email = $1 and i.redeemed_email = w.email and i.redeemed_at is not null
     ) as member`, [email],
  );
  return rows[0].member;
}

export async function verifiedEmail(req: FastifyRequest): Promise<string | null> {
  if (req.campaignIdentity) return req.campaignIdentity.email;
  if (req.privyDid) return getLinkedEmail(req.privyDid);
  if (config.isLocal && !privyConfigured() && req.userId)
    return (await findUserById(req.userId))?.email ?? null;
  return null;
}

/** Attached only to customer route scopes; partner/admin APIs retain their own authorization. */
export async function requireFlist(req: FastifyRequest, reply: FastifyReply) {
  if (!req.privyDid && !req.userId && !req.campaignIdentity) return reply.code(401).send({ error: 'unauthorized' });
  try {
    const email = await verifiedEmail(req);
    if (!email) return reply.code(403).send({ error: 'verified_email_required' });
    if (!(await isFlistMember(email))) return reply.code(403).send({ error: 'flist_required' });
  } catch {
    return reply.code(503).send({ error: 'flist_unavailable' });
  }
}
