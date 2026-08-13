// auth.ts — request identity.
//
// Privy mode (when PRIVY_APP_ID/SECRET set): verify the `Authorization: Bearer` access token,
// map the Privy DID → our DB user, and set req.userId (+ req.privyDid for /auth/sync).
// Dev mode (Privy not configured): fall back to the `x-dev-user-id` header.
import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from './envConfig';
import { findUserById, findUserByPrivyDid, getMerchantForUser, touchMerchantSeen, type MerchantRow } from './db/queries';
import { privyConfigured, verifyAccessToken } from './services/privy';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    privyDid?: string;
  }
}

/** preHandler: populate req.userId (and req.privyDid in Privy mode).
 *
 *  Also the ONE suspension gate: this hook already holds the user row on every authed request, so
 *  `status='suspended'` 403s here and every route — current and future — is covered at once.
 *  403 with a named code, never 401: clients sign out on `no_account`, and a suspended user is
 *  signed IN, just not welcome. Admins are exempt — this hook runs before requireAdmin, and a
 *  blanket 403 would lock a mistakenly-suspended admin out of the console that could fix it,
 *  defeating the ADMIN_EMAILS recovery bootstrap below. */
export async function authPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const authz = req.headers.authorization;
  if (privyConfigured() && typeof authz === 'string' && authz.startsWith('Bearer ')) {
    try {
      const { privyDid } = await verifyAccessToken(authz.slice(7));
      const user = await findUserByPrivyDid(privyDid); // null until /auth/sync runs
      // Assigned only once the lookup RETURNS. A thrown query (DB down) must not be able to look
      // like "no account" — clients sign themselves out on that answer, so a database blip would
      // log out every user at once. privyDid set + no userId now means exactly one thing: we
      // verified you, we asked the DB, and you have no row.
      req.privyDid = privyDid;
      if (user && user.status !== 'active' && effectiveRole(user) !== 'admin') {
        // Same gate, two answers: web paints a different full-screen for each (paused vs deleted).
        return reply.code(403).send({ error: user.status === 'deleted' ? 'account_deleted' : 'account_suspended' });
      }
      if (user) req.userId = user.id;
    } catch (e) {
      // invalid token (or DB unavailable) → leave unauthenticated; requireUserId will 401
      req.log.warn({ err: e }, 'privy bearer token rejected');
    }
    return;
  }
  // Dev fallback only in a dev/stage environment AND when Privy is unconfigured — never let a prod
  // misconfig (missing PRIVY secret) turn the spoofable x-dev-user-id header into an auth bypass.
  if (config.isDevelopment && !privyConfigured()) {
    const hdr = req.headers['x-dev-user-id'];
    if (typeof hdr === 'string' && hdr.length > 0) {
      // The header names a row directly, so fetch it for the same suspension gate as the Privy
      // path. An id with no row still sets userId (matches old behavior; routes 404 as before).
      const user = await findUserById(hdr);
      if (user && user.status !== 'active' && effectiveRole(user) !== 'admin') {
        return reply.code(403).send({ error: user.status === 'deleted' ? 'account_deleted' : 'account_suspended' });
      }
      req.userId = hdr;
    }
  }
}

function unauthorized(message = 'unauthorized'): Error & { statusCode?: number } {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = 401;
  return err;
}

/** Throw 401 unless the request maps to a DB user.
 *  A verified privyDid with no userId is the one 401 worth naming: the token is FINE and the account
 *  simply doesn't exist on this environment (nothing has run /auth/sync for it — and the console
 *  never does, only web). Identical to a rejected token otherwise, which is a bare 401 with nothing
 *  to go on; that ambiguity has now cost an evening on prod and an investigation on local. */
export function requireUserId(req: FastifyRequest): string {
  if (!req.userId) throw unauthorized(req.privyDid ? 'no_account' : 'unauthorized');
  return req.userId;
}

/** Throw 401 unless the request carries a verified Privy DID (used by /auth/sync before the user exists). */
export function requirePrivyDid(req: FastifyRequest): string {
  if (!req.privyDid) throw unauthorized();
  return req.privyDid;
}

/**
 * Throw 403 unless this user runs a merchant/LP account. Returns `kybStatus` instead of filtering on
 * 'approved' here: the dashboard and the stake-deposit routes must work while still pending (staking
 * is part of how an LP becomes routable), while order-serving routes require approved. One helper,
 * callers check the field — two helpers would be an abstraction over a single branch.
 */
export async function requireMerchant(req: FastifyRequest): Promise<MerchantRow> {
  const userId = requireUserId(req);
  const merchant = await getMerchantForUser(userId);
  if (!merchant) {
    const err = new Error('not_a_merchant') as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
  // Liveness, for free: every merchant route already comes through here, and "was this LP doing
  // anything in the last minute" is the strongest available predictor of whether they'll actually
  // pay an order now. Throttled to one write a minute inside the UPDATE, and not awaited — a
  // liveness ping must never be able to fail or slow down the request it rode in on.
  void touchMerchantSeen(merchant.id).catch(() => {});
  return merchant;
}

/** True if this address is a ROOT admin: named in ADMIN_EMAILS, therefore admin regardless of what
 *  the users row says, and undemotable. The bootstrap that makes the console recoverable — a bad
 *  demote can't lock everyone out, because the env still names someone who gets in. */
export function isRootAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email) && config.adminEmails.includes(email!.trim().toLowerCase());
}

/**
 * The role that actually governs, which is not always the column: ADMIN_EMAILS outranks
 * `users.role` by design, so a root admin whose row still says 'user' IS an admin.
 *
 * Every place that asks "is this person an admin" must ask HERE. It used to be asked twice — once
 * by requireAdmin and once by GET /me — and the two answers disagreed for exactly the root admins
 * the env var exists to rescue: the API let them in while /me reported them ordinary. Harmless
 * while nothing read /me's answer, and a lockout the moment the console gated its UI on it.
 */
export function effectiveRole(
  user: { role?: string | null; email?: string | null } | null | undefined,
): string | undefined {
  if (!user) return undefined;
  return isRootAdminEmail(user.email) ? 'admin' : (user.role ?? undefined);
}

/** Throw 403 unless the user is an admin: either role='admin' in the DB (granted from the console)
 *  or a root admin named in ADMIN_EMAILS. The email is the Privy-verified login address, written to
 *  users.email at sync — never a self-claimed value. */
export async function requireAdmin(req: FastifyRequest): Promise<string> {
  const userId = requireUserId(req);
  const user = await findUserById(userId);
  if (effectiveRole(user) !== 'admin') {
    const err = new Error('not_admin') as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
  return userId;
}
