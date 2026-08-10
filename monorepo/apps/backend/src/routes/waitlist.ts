// waitlist.ts — public email capture for the landing page (the f list). Deliberately never calls
// requireUserId (same public mechanism as webhooks) and lives outside system.ts, whose surface
// documents a no-PII invariant. Abuse-bounded by the IP-keyed rate limit rule, not by auth.
// Always answers 201 — including duplicates — so the form can't leak who is already on the list.
//
// Referral loop: every member gets a share code, and `?ref=` on the landing page carries either an
// app user's '@handle' or another member's code back here. Codes and confirm tokens are both
// HMAC(WAITLIST_SECRET, purpose:email) — deterministic, so nothing needs to be stored or expired and
// a re-submit yields the same code. With WAITLIST_SECRET unset no codes are minted and no mail goes
// out; signups still work exactly as they did before the loop existed.
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import type { WaitlistJoinRequest, WaitlistJoinResponse } from '@fpay/shared';

import { config } from '../envConfig';
import { addWaitlistEmail, countWaitlistFrens, verifyWaitlistEmail, waitlistPosition } from '../db/queries';
import { sendEmail, waitlistConfirmEmail } from '../services/email';

// The four helpers below are exported only so scripts/check-waitlist.ts can assert against the real
// implementation rather than a copy of it. Nothing else imports them.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches both shapes a ref can take: '@asha' (an app user's handle) and 'k3n8q2wp' (a member code).
export const REF_RE = /^@?[a-z0-9_]{1,20}$/;

const sig = (purpose: string, email: string) =>
  createHmac('sha256', config.waitlistSecret).update(`${purpose}:${email}`).digest('base64url');

/** A member's own share code. Lowercase alnum so it survives being read aloud and retyped. */
export const refCode = (email: string) => sig('ref', email).replace(/[-_]/g, '').slice(0, 8).toLowerCase();

export const confirmToken = (email: string) =>
  `${Buffer.from(email).toString('base64url')}.${sig('verify', email)}`;

/** Normalise an inbound `?ref=`, or undefined if it must not be stored.
 *  Anything unparseable is DROPPED, never rejected: an invite is marketing, and a typo in someone
 *  else's handle must not cost this person their signup. Existence is deliberately not checked —
 *  that would answer "is @x a real user?" for an unauthenticated caller. `ownCode` is dropped
 *  because attribution is last-touch (see queries.ts) and everyone is shown their own share code,
 *  so pasting it back would otherwise make them their own fren. */
export function sanitizeRef(raw: unknown, ownCode: string | null): string | undefined {
  const ref = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return REF_RE.test(ref) && ref !== ownCode ? ref : undefined;
}

/** Recover the email a confirm token vouches for, or null if it wasn't minted by this server. */
export function readConfirmToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const email = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
  if (!EMAIL_RE.test(email)) return null;
  const want = Buffer.from(sig('verify', email));
  const got = Buffer.from(token.slice(dot + 1));
  // Length check first: timingSafeEqual throws on a mismatch rather than returning false.
  return want.length === got.length && timingSafeEqual(want, got) ? email : null;
}

export async function registerWaitlistRoutes(app: FastifyInstance) {
  app.post<{ Body: WaitlistJoinRequest }>('/waitlist', async (req, reply) => {
    const email = (req.body?.email ?? '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) return reply.code(400).send({ error: 'invalid_email' });
    const city = typeof req.body?.city === 'string' ? req.body.city.trim().slice(0, 64) : undefined;
    const code = config.waitlistSecret ? refCode(email) : null;
    const ref = sanitizeRef(req.body?.ref, code);
    const { verifiedAt } = await addWaitlistEmail(email, city || undefined, code, ref);
    const [position, frens] = await Promise.all([waitlistPosition(email), code ? countWaitlistFrens(code) : 0]);

    // Re-sending to an unverified address is intentional (people lose the first mail); an already
    // confirmed one gets nothing, so re-submitting can't be used to mailbomb someone.
    if (code && !verifiedAt) {
      const base = config.publicBaseUrl || `http://localhost:${config.port}`;
      const { subject, html } = waitlistConfirmEmail(
        `${base}/waitlist/verify?t=${encodeURIComponent(confirmToken(email))}`,
        `${config.landingUrl}/?ref=${code}`,
      );
      void sendEmail(email, subject, html);
    }

    const body: WaitlistJoinResponse = { ok: true, code, position, frens };
    return reply.code(201).send(body);
  });

  // Confirm click. Always redirects, never returns JSON — a human opened this from a mail client, so
  // the only useful response is the landing page. Idempotent: clicking twice still lands on ?v=1.
  app.get<{ Querystring: { t?: string } }>('/waitlist/verify', async (req, reply) => {
    const email = config.waitlistSecret ? readConfirmToken(req.query?.t ?? '') : null;
    if (!email) return reply.redirect(`${config.landingUrl}/?v=0`, 302);
    await verifyWaitlistEmail(email);
    return reply.redirect(`${config.landingUrl}/?v=1`, 302);
  });
}
