// auth.ts — request identity.
//
// Dynamic verifies the bearer token and binds its verified email to an existing profile.
// Historical privyDid field names remain for database compatibility; they carry Dynamic subjects.
// Local development can use x-dev-user-id only when Dynamic is not configured.
import type { FastifyReply, FastifyRequest } from 'fastify';

import { authenticateDynamic, dynamicConfigured, type CampaignIdentity } from './services/dynamic';
import { config } from './envConfig';
import { findUserById, findOrBindDynamicUser, getMerchantForUser, touchMerchantSeen, IdentityAlreadyBoundError, type MerchantRow, type UserRow } from './db/queries';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    privyDid?: string;
    campaignIdentity?: CampaignIdentity;
  }
}

/** preHandler: populate req.userId (and req.privyDid for Dynamic identities).
 *
 *  Also the ONE suspension gate: this hook already holds the user row on every authed request, so
 *  `status='suspended'` 403s here and every route — current and future — is covered at once.
 *  403 with a named code, never 401: clients sign out on `no_account`, and a suspended user is
 *  signed IN, just not welcome. Admins are exempt — this hook runs before requireAdmin, and a
 *  blanket 403 would lock a mistakenly-suspended admin out of the console that could fix it,
 *  defeating the ADMIN_EMAILS recovery bootstrap below. */
export async function authPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const authz = req.headers.authorization;
  if (dynamicConfigured() && typeof authz === 'string' && authz.startsWith('Bearer ')) {
    let identity: CampaignIdentity;
    try { identity = await authenticateDynamic(authz.slice(7)); }
    catch (error) {
      // Log classification only: never serialize a token, credential, or provider response.
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      const known = ['invalid_dynamic_session', 'dynamic_not_configured', 'dynamic_identity_mismatch',
        'verified_email_required', 'ambiguous_dynamic_wallet', 'ambiguous_dynamic_solana_wallet',
        'dynamic_profile_unavailable', 'dynamic_profile_unauthorized'];
      const reason = code.startsWith('ERR_J') ? code :
        error instanceof Error && known.includes(error.message) ? error.message : 'provider_request_failed';
      const claim = error instanceof Error && 'claim' in error &&
        ['sub', 'iat', 'exp', 'iss', 'aud', 'scope'].includes(String(error.claim)) ? String(error.claim) : undefined;
      req.log.warn({ reason, claim }, 'Dynamic authentication failed');
      const unavailable = reason === 'provider_request_failed' || reason === 'dynamic_profile_unavailable' || reason === 'ERR_JWKS_TIMEOUT';
      return reply.code(unavailable ? 503 : 401).send({ error: unavailable ? 'dynamic_temporarily_unavailable' : 'unauthorized' });
    }
    // Database failures propagate as server failures, never as a missing account.
    let user: UserRow | null;
    try { user = await findOrBindDynamicUser(identity.subject, identity.email); }
    catch (error) {
      if (error instanceof IdentityAlreadyBoundError)
        return reply.code(409).send({ error: 'identity_already_bound' });
      throw error;
    }
    req.campaignIdentity = identity;
    req.privyDid = identity.subject;
    if (user && user.status !== 'active' && effectiveRole(user) !== 'admin')
      return reply.code(403).send({ error: user.status === 'deleted' ? 'account_deleted' : 'account_suspended' });
    if (user) req.userId = user.id;
    return;
  }
  if (config.isLocal && !dynamicConfigured()) {
    const hdr = req.headers['x-dev-user-id'];
    if (typeof hdr === 'string' && hdr.length > 0) {
      // The header names a row directly, so fetch it for the same suspension gate as the Dynamic
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
 *  simply doesn't exist on this environment (nothing has run /auth/sync for it — web and the LP
 *  console both do on first sign-in; the admin console never does). Identical to a rejected token
 *  otherwise, which is a bare 401 with nothing
 *  to go on; that ambiguity has now cost an evening on prod and an investigation on local. */
export function requireUserId(req: FastifyRequest): string {
  if (!req.userId) throw unauthorized(req.privyDid ? 'no_account' : 'unauthorized');
  return req.userId;
}

/** Throw 401 unless the request carries a verified auth subject (used by /auth/sync before the user exists). */
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
