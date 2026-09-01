// check-api-headers — the one rule in services/api.ts `req()` that is worth a guard: never claim a
// JSON body we aren't sending. A copy of apps/lp's (which copied apps/web's).
//
// Fastify's default parser answers a bodyless request carrying `content-type: application/json`
// with 400 FST_ERR_CTP_EMPTY_JSON_BODY, and it does so at the PARSING stage — before the auth
// preHandler, so the route never runs and the backend logs nothing interesting. DELETE included:
// the payload is parsed whenever a content-type is present. This console's two bodyless DELETEs
// (denylist remove, invite revoke) 400'd that way from the day they shipped; nothing else in the
// codebase would fail if this regressed.
//
// Pure: fetch is stubbed, no network, no DB. Runs in about a second like the other check:* scripts.
import assert from 'node:assert/strict';

import { req } from '../src/services/api';

type Captured = { url: string; headers: Record<string, string>; init: RequestInit };

const calls: Captured[] = [];

globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
  calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string>, init });
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
    text: async () => '{"ok":true}',
  } as unknown as Response;
}) as typeof fetch;

const lastHeaders = () => {
  const last = calls.at(-1);
  assert.ok(last, 'expected req() to have called fetch');
  // Header names are written lowercase in req(); normalize anyway so a casing change is not a
  // false pass.
  return Object.fromEntries(Object.entries(last.headers).map(([k, v]) => [k.toLowerCase(), v]));
};

// Wrapped because this workspace transpiles to CJS (no "type": "module"), where top-level await
// isn't available.
async function main(): Promise<void> {
  // 1. A bodyless DELETE must NOT announce a JSON body — this is the whole bug.
  await req('/admin/invites/FP-XXXX-XXXX', { method: 'DELETE' });
  assert.equal(
    lastHeaders()['content-type'],
    undefined,
    'bodyless DELETE must not send content-type: application/json (Fastify 400s it before the route runs)',
  );

  // 2. A GET likewise carries no body and needs no content-type.
  await req('/me');
  assert.equal(lastHeaders()['content-type'], undefined, 'GET must not send a content-type');

  // 3. A POST that DOES send a body must still declare JSON, or Fastify won't parse it at all.
  await req('/auth/sync', { method: 'POST', body: JSON.stringify({ handle: '@x' }) });
  assert.equal(
    lastHeaders()['content-type'],
    'application/json',
    'a POST with a body must declare application/json',
  );

  // 4. An explicit caller-supplied content-type still wins (the spread order in req()).
  await req('/x', { method: 'POST', body: 'raw', headers: { 'content-type': 'text/plain' } });
  assert.equal(lastHeaders()['content-type'], 'text/plain', 'caller headers must override the default');

  console.log('check-api-headers: ok');
}

void main();
