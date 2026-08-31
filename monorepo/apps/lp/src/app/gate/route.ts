// gate/route.ts — receives the access-key form the middleware serves (src/middleware.ts). A
// byte-for-byte copy of apps/web's — change both.
import { type NextRequest, NextResponse } from 'next/server';

import { expectedCookie, GATE_COOKIE, sameOriginDest, sha256Hex } from '@/lib/gate';
import { ACCESS_KEY, IS_DEV } from '@/services/envConfig';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const key = String(form.get('key') ?? '').trim();
  // Where the device was heading. Resolved and origin-checked on BOTH branches — a cross-site POST
  // with a junk key would otherwise bounce a victim wherever `next` pointed.
  const dest = sameOriginDest(String(form.get('next') ?? ''), req.url);
  // Compare digests, not the strings — string compare leaks position-of-first-wrong-byte timing.
  const ok = ACCESS_KEY.length > 0 && (await sha256Hex(key)) === (await expectedCookie());
  if (!ok) {
    dest.searchParams.set('err', '1');
    return NextResponse.redirect(dest, 303);
  }

  const res = NextResponse.redirect(dest, 303);
  res.cookies.set(GATE_COOKIE, await expectedCookie(), {
    httpOnly: true,
    secure: !IS_DEV,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // "remember this device" — rotate the key to evict every device
  });
  return res;
}

// Direct visits (back button, bookmarks) just go home; middleware decides what home shows.
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/', req.url), 303);
}
