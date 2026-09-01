// gate.ts — shared bits of the deploy access gate (see src/middleware.ts). One key per project per
// environment gates the DOOR, not the user; a device that has entered it carries the key's SHA-256
// in a cookie and never sees the form again. The cookie is per-origin, so passing this app's gate
// opens no other gated app (a byte-for-byte copy of apps/web's — change both).
// WebCrypto only, so this runs on the edge runtime too.
import { ACCESS_KEY } from '@/services/envConfig';

export const GATE_COOKIE = 'fpay_gate';

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The cookie value a device that knows the key carries — what /gate sets, what middleware expects. */
export function expectedCookie(): Promise<string> {
  return sha256Hex(ACCESS_KEY);
}

/** Where a device that just used the form should land: the path it asked for (the middleware puts it
 *  in the form), honoured ONLY when it resolves to THIS origin. A prefix test is an open redirect —
 *  `new URL('/\\evil.com', base)` is `https://evil.com/` — so resolve first and compare origins;
 *  anything else, or anything malformed, goes home. `apps/web/scripts/check-gate.ts` asserts the cases. */
export function sameOriginDest(next: string, base: string): URL {
  const home = new URL('/', base);
  try {
    const to = new URL(next || '/', base);
    return to.origin === home.origin ? to : home;
  } catch {
    return home;
  }
}
