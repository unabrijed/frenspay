// gateHtml.ts — the access-gate document middleware.ts serves with status 401. Hand-written
// standalone HTML on purpose (a page would boot the whole provider tree for strangers), so the
// mark geometry and the few keyframes it uses are COPIED from primitives.tsx / globals.css /
// the landing's glance pattern rather than imported — nothing from the app tree loads here.
//
// Motion, all CSS: the frens drop in and the link draws itself (fp-dot-in / fp-link-draw); at
// rest they occasionally lean toward each other (the 7s loop); when the key field has focus the
// pair look down at it (the landing's :has() form-glance — which is why the input has no
// autofocus: an autofocused page loads pre-glanced and the entrance never reads). The lean lives
// in animation-slot variables that clear on focus so it can never fight the glance translate.
import { colors } from '@fpay/shared';

// One copy of the curve — same source of truth rule as primitives.tsx.
const LINK = 'M60 136 C82 132 98 184 128 192 C158 184 174 132 196 136';

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function gateHtml(err: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>frenspay</title>
<link rel="icon" href="/icon.svg">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  :root { --ease: cubic-bezier(0.22, 1, 0.36, 1); }
  body {
    min-height: 100dvh; display: grid; place-items: center;
    background: ${colors.canvas}; color: ${colors.ink};
    font-family: 'Hanken Grotesk', system-ui, sans-serif; padding: 24px;
  }
  main { width: 100%; max-width: 380px; text-align: center; }
  .veil, .grain { position: fixed; inset: 0; pointer-events: none; }
  .veil { background: radial-gradient(ellipse at center, transparent 55%, rgb(30 27 25 / 8%) 100%); }
  .grain { opacity: 0.05; background-image: ${GRAIN}; background-size: 200px 200px; }

  .mark { overflow: visible; margin-bottom: 16px; }
  .mark .dot, .mark .link { transform-box: fill-box; transition: translate 260ms var(--ease); }
  .dot-l { animation: dot-in 420ms var(--ease) both, var(--lean-l, none); }
  .dot-r { animation: dot-in 420ms var(--ease) 120ms both, var(--lean-r, none); }
  .link  { animation: draw 620ms var(--ease) 300ms both, var(--lean-k, none); }
  body:not(:has(input:focus)) main {
    --lean-l: lean-l 7s var(--ease) 1.4s infinite;
    --lean-r: lean-r 7s var(--ease) 1.4s infinite;
    --lean-k: lean-k 7s var(--ease) 1.4s infinite;
  }
  body:has(input:focus) .dot-l { translate: 10% 32%; }
  body:has(input:focus) .dot-r { translate: -10% 32%; }
  body:has(input:focus) .link  { translate: 0 10%; }
  @keyframes dot-in { from { opacity: 0; translate: 0 -75%; } }
  @keyframes draw { from { stroke-dasharray: 1; stroke-dashoffset: 1; } to { stroke-dasharray: 1; stroke-dashoffset: 0; } }
  @keyframes lean-l { 0%, 62%, 100% { translate: 0 0; } 74%, 88% { translate: 16% 0; } }
  @keyframes lean-r { 0%, 62%, 100% { translate: 0 0; } 74%, 88% { translate: -16% 0; } }
  @keyframes lean-k { 0%, 62%, 100% { translate: 0 0; } 74%, 88% { translate: 0 8%; } }
  @keyframes rise { from { opacity: 0; translate: 0 6px; } }

  h1 { font-weight: 700; font-size: 30px; letter-spacing: -0.02em; color: ${colors.accent}; animation: rise 420ms var(--ease) 350ms both; }
  .sub { color: ${colors.muted}; margin: 10px auto 0; font-size: 15px; line-height: 1.5; max-width: 36ch; animation: rise 420ms var(--ease) 430ms both; }
  form { margin-top: 28px; display: grid; gap: 10px; animation: rise 420ms var(--ease) 510ms both; }
  input {
    font: inherit; text-align: center; padding: 14px 16px; border-radius: 12px;
    border: 1px solid ${colors.outlineVariant}; background: ${colors.surface}; color: ${colors.ink};
  }
  input::placeholder { color: ${colors.outline}; }
  input:focus { outline: 2px solid ${colors.accent}; outline-offset: -1px; border-color: transparent; }
  input.shake { animation: shake 200ms var(--ease) 600ms; }
  @keyframes shake { 25% { translate: -4px 0; } 75% { translate: 4px 0; } }
  button {
    font: inherit; font-weight: 700; padding: 14px 16px; border-radius: 12px; border: 0;
    background: ${colors.accent}; color: #fff; cursor: pointer;
    box-shadow: 0 4px 14px rgba(166, 52, 31, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.2);
    transition: filter 140ms var(--ease), translate 140ms var(--ease);
  }
  button:hover { filter: brightness(1.06); }
  button:active { translate: 0 1px; }
  .err { color: ${colors.accent}; font-size: 14px; animation: rise 420ms var(--ease) both; }

  @media (prefers-reduced-motion: reduce) {
    .dot-l, .dot-r, .link, h1, .sub, form, input.shake, .err { animation: none; }
    .mark .dot, .mark .link, button { transition: none; }
  }
</style>
</head>
<body>
<main>
  <svg class="mark" width="88" height="88" viewBox="0 0 256 256" fill="none" aria-hidden="true">
    <path class="link" d="${LINK}" pathLength="1" stroke="${colors.accent}" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="dot dot-l" cx="66" cy="74" r="31" fill="${colors.accent}"/>
    <circle class="dot dot-r" cx="190" cy="74" r="31" fill="${colors.accent}"/>
  </svg>
  <h1>frenspay</h1>
  <p class="sub">A private build. Enter your access key to continue — this device will remember it.</p>
  <form method="post" action="/gate">
    <input type="password" name="key" placeholder="Access key" aria-label="Access key" autocomplete="off" required${err ? ' class="shake"' : ''}>
    <button type="submit">Continue</button>
    ${err ? '<p class="err">That key didn&#8217;t work. Check it and try again.</p>' : ''}
  </form>
</main>
<div class="veil"></div>
<div class="grain"></div>
</body>
</html>`;
}
