// check-api-headers — the one rule in services/api.ts `req()` that is worth a guard: never claim a
// JSON body we aren't sending.
//
// Fastify's default parser answers a bodyless POST carrying `content-type: application/json` with
// 400 FST_ERR_CTP_EMPTY_JSON_BODY, and it does so at the PARSING stage — before the auth preHandler,
// so the route never runs and the backend logs nothing interesting. That killed every no-body POST
// we have (invite ack, cancel request, cancel order, mark-all-read, the dev KYC reset) with no
// visible symptom except one screen that refused to advance. Nothing else in the codebase would
// have failed if this regressed.
//
// Pure: fetch is stubbed, no network, no DB. Runs in about a second like the other check:* scripts.
import assert from 'node:assert/strict';

import { configure } from '@fpay/app/configure'; // the subpath: the barrel pulls TSX through tsx's classic runtime

import { webPlatform } from '../src/platform';
import { req, requestFlist, setAuthToken, setTokenRefresher } from '../src/services/api';

// req() reads the API base through the platform seam; boot it the way AppProviders does.
configure(webPlatform);

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
  // 1. A bodyless POST must NOT announce a JSON body — this is the whole bug.
  await req('/me/invites/ack', { method: 'POST' });
  assert.equal(
    lastHeaders()['content-type'],
    undefined,
    'bodyless POST must not send content-type: application/json (Fastify 400s it before the route runs)',
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

  // Access checks precede the bridge and must never inherit a previous account's token.
  setAuthToken('previous-account');
  setTokenRefresher(async () => 'previous-account');
  await requestFlist(async () => 'current-account');
  assert.equal(lastHeaders().authorization, 'Bearer current-account');
  assert.equal(calls.at(-1)?.init.cache, 'no-store');
  const before = calls.length;
  await assert.rejects(requestFlist(async () => null), /unauthorized/);
  assert.equal(calls.length, before, 'missing session cannot fall back to a cached account or dev header');
  await requestFlist(async () => 'current-account', 'FREN-1234-5678');
  assert.equal(lastHeaders()['content-type'], 'application/json');
  assert.equal(calls.at(-1)?.init.body, JSON.stringify({ code: 'FREN-1234-5678' }));

  // An expired Dynamic token must actually rotate, then retry once with the new token.
  let currentToken = 'expired';
  const refreshCalls: boolean[] = [];
  setTokenRefresher(async (force = false) => {
    refreshCalls.push(force);
    if (force) currentToken = 'renewed';
    return currentToken;
  });
  let attempts = 0;
  globalThis.fetch = (async (_url, init) => {
    attempts++;
    const authorization = (init?.headers as Record<string, string>).authorization;
    return new Response(JSON.stringify(authorization === 'Bearer renewed' ? {ok:true} : {error:'unauthorized'}),
      {status: authorization === 'Bearer renewed' ? 200 : 401});
  }) as typeof fetch;
  assert.deepEqual(await req('/me'), {ok:true});
  assert.equal(attempts, 2);
  assert.deepEqual(refreshCalls, [false, true, false]);
  globalThis.fetch = (async () => { attempts++; return new Response('{"error":"unauthorized"}', {status:401}); }) as typeof fetch;
  attempts = 0;
  await assert.rejects(req('/me'), /unauthorized/);
  assert.equal(attempts, 2, 'a rejected session must not loop');
  setAuthToken(null);
  setTokenRefresher(null);

  console.log('check-api-headers: ok');
}

void main();
