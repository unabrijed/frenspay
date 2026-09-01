// email.ts — one rule for every fpay-owned email field (the three login screens; the landing
// waitlist keeps a copy). Privy is the actual authority on what an address IS — these exist so a
// typo is caught before a code is sent, and so the address we hand Privy is the same string every
// time it is typed: `Bridge@X.com ` and `bridge@x.com` are one mailbox and must stay one login.
//
// Byte-identical copies, on purpose: `apps/backend/src/routes/waitlist.ts` (the backend may only
// `import type` from this package) and `apps/landing/src/lib/email.ts` (landing has no @fpay/shared
// dependency). Change one, change all three.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Canonical form — trimmed, lowercased. The backend stores users.email this way (0025). */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

/** Loose on purpose (RFC 5322 is not a regex): something@something.something, ≤ 254 chars. */
export function isValidEmail(raw: string): boolean {
  const e = normalizeEmail(raw);
  return e.length > 0 && e.length <= 254 && EMAIL_RE.test(e);
}
