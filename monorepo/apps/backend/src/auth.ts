// auth.ts — request identity.
//
// Privy mode (when PRIVY_APP_ID/SECRET set): verify the `Authorization: Bearer` access token,
// map the Privy DID → our DB user, and set req.userId (+ req.privyDid for /auth/sync).
// Dev mode (Privy not configured): fall back to the `x-dev-user-id` header.
import type { FastifyReply, FastifyRequest } from 'fastify';

import { findUserByPrivyDid } from './db/queries';
import { privyConfigured, verifyAccessToken } from './services/privy';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    privyDid?: string;
  }
}

/** preHandler: populate req.userId (and req.privyDid in Privy mode). */
export async function authPreHandler(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const authz = req.headers.authorization;
  if (privyConfigured() && typeof authz === 'string' && authz.startsWith('Bearer ')) {
    try {
      const { privyDid } = await verifyAccessToken(authz.slice(7));
      req.privyDid = privyDid;
      const user = await findUserByPrivyDid(privyDid); // null until /auth/sync runs
      if (user) req.userId = user.id;
    } catch (e) {
      // invalid token (or DB unavailable) → leave unauthenticated; requireUserId will 401
      req.log.warn({ err: e }, 'privy bearer token rejected');
    }
    return;
  }
  // Dev fallback only when Privy is not configured.
  if (!privyConfigured()) {
    const hdr = req.headers['x-dev-user-id'];
    if (typeof hdr === 'string' && hdr.length > 0) req.userId = hdr;
  }
}

function unauthorized(): Error & { statusCode?: number } {
  const err = new Error('unauthorized') as Error & { statusCode?: number };
  err.statusCode = 401;
  return err;
}

/** Throw 401 unless the request maps to a DB user. */
export function requireUserId(req: FastifyRequest): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}

/** Throw 401 unless the request carries a verified Privy DID (used by /auth/sync before the user exists). */
export function requirePrivyDid(req: FastifyRequest): string {
  if (!req.privyDid) throw unauthorized();
  return req.privyDid;
}
