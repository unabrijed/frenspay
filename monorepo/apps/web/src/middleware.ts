// middleware.ts — deploy access gate. Stage/prod deploys each set their own random key
// (STAGE_ACCESS_KEY / ACCESS_KEY — see DEPLOY.stage.md); until a device presents it, every route
// serves the key form (lib/gateHtml.ts) instead of the app. This is a door-lock for unreleased
// deploys, not auth — Privy is the real auth inside. The form is hand-written HTML on purpose: a
// normal page would boot the whole provider tree (Privy included) for strangers via the root layout.
import { type NextRequest, NextResponse } from 'next/server';

import { expectedCookie, GATE_COOKIE } from '@/lib/gate';
import { gateHtml } from '@/lib/gateHtml';
import { ACCESS_KEY, IS_LOCAL_ENV } from '@/services/envConfig';

export async function middleware(req: NextRequest) {
  if (!ACCESS_KEY) {
    // Local dev (`next dev` → tier 'local') runs ungated. A deployed tier with no key is a
    // misconfiguration — fail closed instead of silently serving the app to strangers.
    // (Testing a local prod build needs ACCESS_KEY in .env.local or NEXT_PUBLIC_APP_ENV=local.)
    if (IS_LOCAL_ENV) return NextResponse.next();
    return new NextResponse('Locked: no access key configured for this deployment.', { status: 503 });
  }
  if (req.cookies.get(GATE_COOKIE)?.value === (await expectedCookie())) return NextResponse.next();
  // The key submission itself must reach the /gate route handler.
  if (req.method === 'POST' && req.nextUrl.pathname === '/gate') return NextResponse.next();
  return new NextResponse(gateHtml(req.nextUrl.searchParams.has('err')), {
    status: 401,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export const config = {
  // Gate everything except Next internals and the icon/manifest fetches a gated tab still makes.
  matcher: ['/((?!_next/|icon\\.svg|apple-icon\\.png|favicon|manifest).*)'],
};
