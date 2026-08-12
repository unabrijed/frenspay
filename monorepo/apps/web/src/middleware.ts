// middleware.ts — deploy access gate. Stage/prod deploys each set their own random key
// (STAGE_ACCESS_KEY / ACCESS_KEY — see DEPLOY.stage.md); until a device presents it, every route
// serves the key form below instead of the app. This is a door-lock for unreleased deploys, not
// auth — Privy is the real auth inside. The form is hand-written HTML on purpose: a normal page
// would boot the whole provider tree (Privy included) for strangers via the root layout.
import { type NextRequest, NextResponse } from 'next/server';

import { colors } from '@fpay/shared';

import { expectedCookie, GATE_COOKIE } from '@/lib/gate';
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

function gateHtml(err: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>fpay</title>
<link rel="icon" href="/icon.svg">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  body {
    min-height: 100dvh; display: grid; place-items: center;
    background: ${colors.canvas}; color: ${colors.ink};
    font-family: 'Hanken Grotesk', system-ui, sans-serif; padding: 24px;
  }
  main { width: 100%; max-width: 360px; }
  h1 { font-weight: 800; font-size: 28px; letter-spacing: -0.02em; }
  p { color: ${colors.muted}; margin-top: 8px; font-size: 15px; line-height: 1.45; }
  form { margin-top: 24px; display: grid; gap: 10px; }
  input {
    font: inherit; padding: 14px 16px; border-radius: 14px;
    border: 1px solid ${colors.outlineVariant}; background: ${colors.surface}; color: ${colors.ink};
  }
  input:focus { outline: 2px solid ${colors.accent}; outline-offset: -1px; border-color: transparent; }
  button {
    font: inherit; font-weight: 700; padding: 14px 16px; border-radius: 14px;
    border: 0; background: ${colors.accent}; color: #fff; cursor: pointer;
  }
  .err { color: ${colors.accent}; }
</style>
</head>
<body>
<main>
  <h1>fpay</h1>
  <p>This is a private build. Enter your access key to continue — this device will remember it.</p>
  <form method="post" action="/gate">
    <input type="password" name="key" placeholder="Access key" autocomplete="off" autofocus required>
    <button type="submit">Continue</button>
    ${err ? '<p class="err">That key didn&#8217;t work. Check it and try again.</p>' : ''}
  </form>
</main>
</body>
</html>`;
}
