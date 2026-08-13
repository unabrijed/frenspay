// invites.ts — minting and canonicalizing invite codes. Pure functions, no DB: the redemption
// itself lives inside the account-creation transaction (db/queries.ts), because a code is only
// safely burned in the same transaction that creates the account it let in.
import { randomBytes } from 'node:crypto';

// Crockford base32 minus I/L/O/U: nothing a human can confuse reading a code off a screen or
// hearing it over the phone. Exactly 32 symbols, so `byte & 31` is uniform (256 = 8 x 32) — there
// is no modulo bias to argue about.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BODY_LEN = 8;
// 'FREN' since 2026-08-13 (Bridge); every FP- code was bulk-revoked and reminted by
// scripts/remint-invites.ts. canonicalInviteCode self-adjusts via PREFIX.length below.
const PREFIX = 'FREN';

/** Codes minted for every account at signup. Admin can mint more; nothing else changes this. */
export const INVITES_PER_USER = 3;

/**
 * 8 symbols from 32 = 40 bits, ~1.1e12 codes. Against even 10k live codes a blind guess lands with
 * probability ~1e-8, so brute force is not a threat before the rate limiter is even consulted.
 *
 * Random, NOT HMAC-derived like the f-list ref code in routes/waitlist.ts: that one must be
 * reproducible from an email so a re-submit doesn't mint a second code. This one must be
 * unguessable, which is the opposite requirement.
 */
export function mintCode(): string {
  const body = Array.from(randomBytes(BODY_LEN), (b) => ALPHABET[b & 31]).join('');
  return `${PREFIX}-${body.slice(0, 4)}-${body.slice(4)}`;
}

/**
 * Accept what a person actually types — lowercase, stray spaces, no dashes, a missing prefix, an
 * O typed for a 0 — and return the single canonical form, or null if it cannot be one. Every
 * comparison and every DB write goes through this, so the column only ever holds canonical codes.
 *
 * Crockford's forgiving decode is the reason I/L/O are folded rather than rejected: they are not in
 * the alphabet, so mapping them in is unambiguous and saves a support round trip. U is excluded and
 * NOT folded — there is nothing to fold it to.
 */
/**
 * Does this /auth/sync have to spend a code? Three ways out, and each is a deliberate carve-out:
 *
 *  - an EXISTING user re-syncing has already paid, whenever they joined — grandfathered for free;
 *  - an EMPTY directory founds itself, or nobody could ever be first;
 *  - a ROOT ADMIN (named in ADMIN_EMAILS) walks in, because that list IS the lockout recovery path.
 *    Codes are minted from the console. Requiring one to reach the console you are locked out of is
 *    a circle, and it left the documented recovery unusable on any non-empty directory.
 *
 * Lives here, pure, rather than as a boolean in the route: nothing can reach that branch without
 * Privy and a database, and a gate bypass that cannot be asserted on is one refactor from silently
 * opening the door. See scripts/check-invites.ts.
 */
export function inviteRequired(o: {
  isExistingUser: boolean;
  directoryHasUsers: boolean;
  isRootAdmin: boolean;
}): boolean {
  return !o.isExistingUser && o.directoryHasUsers && !o.isRootAdmin;
}

export function canonicalInviteCode(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let body = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  // Strip the prefix only when doing so leaves exactly a body. A real body may itself start with
  // 'FREN', and at 8 characters that is what it is — length disambiguates, guessing does not.
  if (body.length === PREFIX.length + BODY_LEN && body.startsWith(PREFIX)) body = body.slice(PREFIX.length);
  body = body.replace(/[IL]/g, '1').replace(/O/g, '0');
  if (body.length !== BODY_LEN) return null;
  for (const ch of body) if (!ALPHABET.includes(ch)) return null;
  return `${PREFIX}-${body.slice(0, 4)}-${body.slice(4)}`;
}
