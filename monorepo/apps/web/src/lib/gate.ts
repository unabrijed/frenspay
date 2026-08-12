// gate.ts — shared bits of the deploy access gate (see src/middleware.ts). One shared key per
// environment gates the DOOR, not the user; a device that has entered it carries the key's SHA-256
// in a cookie and never sees the form again. WebCrypto only, so this runs on the edge runtime too.
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
