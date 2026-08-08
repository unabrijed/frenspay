// Client-side email checks for the f-list form.
//
// EMAIL_RE and MAX_LENGTH are a deliberate copy of the server's, in
// apps/backend/src/routes/waitlist.ts. THE TWO MUST CHANGE TOGETHER.
// They cannot be shared: the backend may only `import type` from @fpay/shared
// (runtime value imports fail under tsx), and the landing does not depend on
// @fpay/shared at all — its five dependencies are deliberate.
//
// The server stays the real gate. Everything here exists to stop a round trip
// for something we can already see is wrong, and to fix the typo the person
// almost certainly made.

// Rejects `a@b`: a dot in the domain is required. Matches waitlist.ts:23.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = 254; // matches waitlist.ts:62

/** Trim both ends and lowercase. Trimming is the point: people paste addresses
 *  with a stray leading or trailing space constantly, and the raw value is then
 *  rejected by the browser's own email validation even though it is fine. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= MAX_LENGTH && EMAIL_RE.test(normalized);
}

// Only the misspellings that actually happen, of only the biggest providers.
// A long list would be a maintenance burden that eventually rejects a real
// domain; this one only ever *suggests*, so a wrong guess costs a glance.
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'iclod.com': 'icloud.com',
  'icloud.con': 'icloud.com',
  'protonmial.com': 'protonmail.com',
};

/** The address this one was probably meant to be, or null if it looks fine.
 *  Suggests, never rejects — the address may be perfectly real. */
export function suggestEmail(normalized: string): string | null {
  const at = normalized.lastIndexOf('@');
  if (at < 1) return null;
  const fixed = DOMAIN_TYPOS[normalized.slice(at + 1)];
  return fixed ? `${normalized.slice(0, at + 1)}${fixed}` : null;
}
