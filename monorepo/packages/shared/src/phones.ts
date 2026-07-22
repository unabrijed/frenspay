// phones.ts — client-side phone-alias helpers (pay-by-phone, UPI-mapper style).
// Dependency-free like chains.ts. The backend keeps its own normalizePhone (it never runtime-
// imports from this package); the server re-validates everything these helpers produce.
import { ISO_TO_DIAL } from './dialCodes';

const E164_RE = /^\+[1-9]\d{6,14}$/;

/** ' +91 98765-43210' → '+919876543210'; null if not E.164. */
export function normalizePhoneInput(raw: string): string | null {
  const s = raw.trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
  return E164_RE.test(s) ? s : null;
}

/** True when the string looks like a phone number being typed (digits/punctuation, not a handle). */
export function looksLikePhone(raw: string): boolean {
  const s = raw.trim();
  return /^[+0-9][\d\s().-]{5,}$/.test(s);
}

/**
 * Candidate E.164 numbers for a search-box / contact-picker / QR string.
 * Priority:
 * 1. '+'-prefixed (or 00-prefixed) input → exactly one strict-E.164 candidate.
 * 2. Sender's country known → ONE candidate: strip one trunk '0', prepend that country's dial
 *    code (the UPI model — "98765 43210" typed in India becomes +91…). Italy's kept-trunk-0
 *    landlines mis-normalize → lookup miss only; aliases are SMS-verified mobiles.
 * 3. Fallback (no country): derive candidate codes from the SEARCHER's own registered number
 *    (1/2/3-digit prefixes, ≤3 lookups); the exact-match directory discards wrong ones.
 * A wrong candidate is a lookup MISS, never a mis-pay — money only moves after
 * resolve → verified-name confirm.
 */
export function phoneCandidates(
  raw: string,
  opts?: { country?: string; ownPhone?: string },
): string[] {
  const s = raw.trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (s.startsWith('+')) return E164_RE.test(s) ? [s] : [];
  const local = s.replace(/^0/, ''); // trunk zero
  if (!/^\d{6,14}$/.test(local)) return [];
  const dial = opts?.country ? ISO_TO_DIAL[opts.country.toUpperCase()] : undefined;
  if (dial) {
    const c = '+' + dial + local;
    return E164_RE.test(c) ? [c] : [];
  }
  if (!opts?.ownPhone?.startsWith('+')) return [];
  const digits = opts.ownPhone.slice(1);
  const candidates = [1, 2, 3].map((n) => '+' + digits.slice(0, n) + local);
  return [...new Set(candidates)].filter((c) => E164_RE.test(c));
}
