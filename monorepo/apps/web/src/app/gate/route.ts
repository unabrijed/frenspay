// gate/route.ts — receives the access-key form the middleware serves (src/middleware.ts).
import { type NextRequest, NextResponse } from 'next/server';

import { expectedCookie, GATE_COOKIE, sha256Hex } from '@/lib/gate';
import { ACCESS_KEY, IS_DEV } from '@/services/envConfig';

export async function POST(req: NextRequest) {
  const key = String((await req.formData()).get('key') ?? '').trim();
  // Compare digests, not the strings — string compare leaks position-of-first-wrong-byte timing.
  const ok = ACCESS_KEY.length > 0 && (await sha256Hex(key)) === (await expectedCookie());
  if (!ok) return NextResponse.redirect(new URL('/?err=1', req.url), 303);

  const res = NextResponse.redirect(new URL('/', req.url), 303);
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
