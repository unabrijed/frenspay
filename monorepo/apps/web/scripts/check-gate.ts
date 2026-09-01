// check-gate — the one rule in lib/gate.ts worth a guard: a device that just entered the access key
// lands where it was heading ONLY when that resolves to this origin. A prefix test (`startsWith('/')`)
// is an open redirect — the WHATWG parser reads `/\\evil.com` as protocol-relative — and the wrong-key
// branch redirects too, so a cross-site POST with a junk key would bounce a victim off-site.
//
// Pure: no network, no DB. apps/lp runs a byte-for-byte copy of lib/gate.ts, so this covers both.
import assert from 'node:assert/strict';

import { sameOriginDest } from '../src/lib/gate';

const base = 'https://app.frenspay.xyz/gate';
const home = 'https://app.frenspay.xyz/';
const cases: [next: string, want: string][] = [
  ['/orders/1?x=1', 'https://app.frenspay.xyz/orders/1?x=1'],
  ['/identity?inquiry-id=abc', 'https://app.frenspay.xyz/identity?inquiry-id=abc'],
  ['/%2F%2Fevil.com', 'https://app.frenspay.xyz/%2F%2Fevil.com'], // encoded stays a path — same origin
  ['', home],
  ['/\\evil.com', home], // the backslash case — passes every prefix test, resolves to evil.com
  ['/\\/evil.com', home],
  ['//evil.com', home],
  ['https://evil.com/x', home],
  ['javascript:alert(1)', home],
  ['http://[', home], // malformed: the parser throws, we go home
];
for (const [next, want] of cases) {
  assert.equal(sameOriginDest(next, base).href, want, `next=${JSON.stringify(next)}`);
}
console.log(`check-gate: OK — ${cases.length} destinations, off-origin and malformed ones go home`);
