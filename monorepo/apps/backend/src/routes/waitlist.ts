// waitlist.ts — the f list. Deliberately never calls requireUserId (same public mechanism as
// webhooks) and lives outside system.ts, whose surface documents a no-PII invariant. Abuse-bounded
// by the IP-keyed rate limit rule, not by auth.
//
// The f list is INVITE-ONLY: a code and an email are both required to join, and joining spends the
// code. It is no longer the queue you fall back to without one — it is the door, and every member
// was let in by somebody. In exchange each member is minted their own three codes to pass on, the
// same allowance an account gets. See db/queries.ts joinWaitlistWithCode for the two locks that make
// "one code, one member" hold under concurrency.
//
// Still 201 for a duplicate email, so the form can't leak who is already on the list. A bad code is
// 404 and a spent one 409 — a caller learns nothing about a code they were not already holding.
//
// Two unrelated code systems share this file, which is worth keeping straight:
//   - the INVITE code ('FP-XXXX-XXXX') — random, stored, spent once. The gate.
//   - the REF code ('k3n8q2wp') and confirm token — both HMAC(WAITLIST_SECRET, purpose:email),
//     deterministic so nothing needs storing or expiring and a re-submit yields the same code. Pure
//     attribution; never redeemed. With WAITLIST_SECRET unset neither is minted and no mail goes out
//     — joining still works, it just goes unattributed and unconfirmed.
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import type { WaitlistJoinRequest, WaitlistJoinResponse } from '@fpay/shared';

import { config } from '../envConfig';
import {
  countWaitlistFrens,
  inviteCodeStatus,
  joinWaitlistWithCode,
  verifyWaitlistEmail,
  waitlistPosition,
} from '../db/queries';
import { sendEmail, waitlistConfirmEmail } from '../services/email';
import { canonicalInviteCode } from '../services/invites';

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
    // The invite gate. Email first, deliberately: a bad address is the caller's own typo and costs
    // nothing to say, while every code answer below is a statement about our data.
    const invite = canonicalInviteCode(req.body?.code ?? '');
    if (!invite) return reply.code(404).send({ error: 'invalid_code' });

    const city = typeof req.body?.city === 'string' ? req.body.city.trim().slice(0, 64) : undefined;
    const code = config.waitlistSecret ? refCode(email) : null;
    const ref = sanitizeRef(req.body?.ref, code);

    let verifiedAt: Date | null;
    let invites: string[];
    try {
      ({ verifiedAt, invites } = await joinWaitlistWithCode({
        email,
        code: invite,
        city: city || undefined,
        refCode: code,
        referredBy: ref,
      }));
    } catch (e) {
      if ((e as { code?: string }).code !== 'invalid_invite') throw e;
      // The join collapses unknown / burned / revoked into one error so it can't be used as an
      // oracle. Only here do we split off the one distinction worth making: "your friend gave you a
      // dead code" is worth saying, and it tells a guesser only which strings are worthless. Revoked
      // stays folded into invalid — an operator killing a code shouldn't advertise it ever existed.
      const status = await inviteCodeStatus(invite);
      return reply.code(status === 'burned' ? 409 : 404).send({
        error: status === 'burned' ? 'code_used' : 'invalid_code',
      });
    }

    const [position, frens] = await Promise.all([waitlistPosition(email), code ? countWaitlistFrens(code) : 0]);

    // Re-sending to an unverified address is intentional (people lose the first mail); an already
    // confirmed one gets nothing, so re-submitting can't be used to mailbomb someone. The mail now
    // also carries their three codes — the success screen is one page view and people close tabs,
    // so the inbox is the durable copy. Nothing needs a "resend my codes" endpoint.
    if (code && !verifiedAt) {
      const base = config.publicBaseUrl || `http://localhost:${config.port}`;
      const { subject, html } = waitlistConfirmEmail(
        `${base}/waitlist/verify?t=${encodeURIComponent(confirmToken(email))}`,
        `${config.landingUrl}/?ref=${code}`,
        invites,
      );
      void sendEmail(email, subject, html);
    }

    // Still 201 for a duplicate EMAIL, so the form can't be used to ask "is this address on the
    // list?". A bad or spent CODE does get its own status — that leaks nothing the caller wasn't
    // already holding, and silently swallowing it would leave them staring at a success screen for
    // a join that never happened.
    const body: WaitlistJoinResponse = { ok: true, code, position, frens, invites };
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
