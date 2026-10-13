// Isolated SQL + HTTP integration tests. Never connects to the application database.
// yarn downloads only: install @electric-sql/pglite into a scratch directory with Yarn,
// then FLIST_PGLITE_MODULE=<absolute dist/index.js> yarn workspace @fpay/backend check:flist:access
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const modulePath = process.env.FLIST_PGLITE_MODULE;
if (!modulePath) throw new Error('Set FLIST_PGLITE_MODULE to an isolated PGlite installation');
const { PGlite } = await import(modulePath);
const db = new PGlite();
const dir = new URL('../src/db/migrations/', import.meta.url);
for (const name of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
  // PGlite provides gen_random_uuid natively; this is the only pgcrypto use in the schema.
  const sql = readFileSync(new URL(name, dir), 'utf8').replace('create extension if not exists "pgcrypto";', '');
  await db.exec(sql);
}
let queue = Promise.resolve();
async function lease() {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  return release;
}
pg.Pool.prototype.connect = (async () => {
  const release = await lease();
  return { query: (sql: string, args?: unknown[]) => db.query(sql, args), release };
}) as any;
pg.Pool.prototype.query = (async (sql: string, args?: unknown[]) => {
  const release = await lease();
  try { return await db.query(sql, args); } finally { release(); }
}) as any;
process.env.LOCAL_DATABASE_URL = 'postgres://isolated.invalid/test';
const { config } = await import('../src/envConfig');
Object.assign(config, { databaseUrl: 'postgres://isolated.invalid/test', isLocal: true,
  dynamicEnvironmentId:'', prelaunchEnabled: true, adminEmails: ['admin@example.test'] });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Unexpected network request in isolated test'); };
const q = await import('../src/db/queries');
const { readFlist } = await import('../src/routes/flist');
const { registerRoutes } = await import('../src/routes');
const app = Fastify();
// Route access uses verified fixtures; check-dynamic separately verifies signed JWTs.
app.addHook('preHandler',async(req,reply)=>{
  const did=req.headers.authorization?.slice(7);
  if(!did||did==='invalid')return;
  if(did==='unavailable')return reply.code(503).send({error:'flist_unavailable'});
  req.privyDid=did;req.campaignIdentity={subject:did,email:did+'@example.test',solanaWalletAddress:did+'-wallet'};
  const user=await q.findUserByPrivyDid(did);if(user)req.userId=user.id;
});
await registerRoutes(app);
const call = (method: 'GET' | 'POST', url: string, did?: string, payload?: unknown) =>
  app.inject({ method, url, ...(did ? { headers: { authorization: `Bearer ${did}` } } : {}), ...(payload ? { payload } : {}) });
const mint = async () => (await q.mintInviteCodes(null, 1, 'isolated-test'))[0];
try {
  assert.equal((await call('GET', '/flist/me')).statusCode, 401);
  assert.equal((await call('GET', '/flist/me', 'invalid')).statusCode, 401);
  assert.equal((await call('GET', '/flist/me', 'unavailable')).statusCode, 503);
  assert.equal((await call('POST', '/prelaunch/session', 'alice')).statusCode, 403);
  const seed = await mint();
  let result = await call('POST', '/waitlist', undefined, { email: ' ALICE@EXAMPLE.TEST ', code: seed });
  assert.equal(result.statusCode, 201, result.body);
  assert.deepEqual(result.json().invites, [], 'public responses never reveal private invite collections');
  result = await call('GET', '/flist/me', 'alice');
  assert.equal(result.statusCode, 200, result.body);
  const first = result.json();
  assert.equal(first.member, true);
  assert.equal(first.invites.length, 3);
  assert.ok((await db.query('select verified_at from waitlist where email=$1', ['alice@example.test'])).rows[0].verified_at);
  const spare = await mint();
  await q.joinWaitlistWithCode({ email: 'alice@example.test', code: spare });
  assert.equal(await q.inviteCodeStatus(spare), 'unused');
  assert.deepEqual((await readFlist('alice@example.test')).invites, first.invites);
  result = await call('POST', '/prelaunch/session', 'alice');
  // Membership passes the customer gate, but the retired campaign stays unavailable.
  assert.equal(result.statusCode, 410, result.body);
  assert.equal(result.json().error, 'campaign_retired');

  // Body/query email cannot read or enroll somebody else's account.
  result = await call('GET', '/flist/me?email=alice@example.test', 'bob');
  assert.equal(result.json().email, 'bob@example.test');
  assert.deepEqual(result.json().invites, []);
  result = await call('POST', '/flist/join', 'bob', { code: seed, email: 'alice@example.test' });
  assert.equal(result.statusCode, 400);
  result = await call('POST', '/flist/join', 'bob', { code: first.invites[0].code, email: 'alice@example.test' });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().email, 'bob@example.test');
  assert.equal((await readFlist('alice@example.test')).invites[0].used, true);

  // Pre-invite waitlist rows need a real redemption.
  await db.query('insert into waitlist(email) values ($1)', ['old@example.test']);
  assert.equal((await readFlist('old@example.test')).member, false);
  await q.joinWaitlistWithCode({ email: 'old@example.test', code: spare });
  assert.equal((await readFlist('old@example.test')).member, true);
  assert.equal(await q.inviteCodeStatus(spare), 'burned');
  const revoked = await mint();
  await db.query('update invite_codes set revoked_at=now() where code=$1', [revoked]);
  await assert.rejects(q.joinWaitlistWithCode({ email: 'denied@example.test', code: revoked }), /invalid_invite/);
  assert.equal((await db.query('select * from waitlist where email=$1', ['denied@example.test'])).rows.length, 0);

  // A web account adopts the same three, even after acknowledgement. No second allowance.
  result = await call('POST', '/auth/sync', 'alice', { handle: '@alice', walletAddress: 'alice-wallet' });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal((await call('GET', '/me', 'alice')).statusCode, 200);
  assert.equal((await call('GET', '/payments/capabilities', 'alice')).statusCode, 200);
  const alice = (await q.findUserByEmail('alice@example.test'))!;
  const bound=await q.findOrBindDynamicUser('dynamic:fixture:alice','alice@example.test');
  assert.equal(bound?.id,alice.id);
  assert.equal((await q.getWalletForUser(alice.id))?.address,'alice-wallet');
  await assert.rejects(q.findOrBindDynamicUser('dynamic:fixture:other','alice@example.test'),/identity_already_bound/);
  assert.equal((await q.findOrBindDynamicUser('dynamic:fixture:alice','alice@example.test'))?.id, alice.id);

  // Exercise the real auth hook with a signed token and offline Dynamic responses.
  // A conflicting identity must not become an authenticated user or change the binding.
  const { authPreHandler } = await import('../src/auth');
  const authApp = Fastify();
  authApp.addHook('preHandler', authPreHandler);
  let reachedRoute = false;
  authApp.get('/probe', async () => { reachedRoute = true; return { ok: true }; });
  const environment = '4fc2a73c-1662-45eb-9257-8baa567066a6';
  const subject = '11111111-1111-4111-8111-111111111111';
  const previousEnvironment = config.dynamicEnvironmentId;
  const previousAudience = config.dynamicAudience;
  const offlineFetch = globalThis.fetch;
  try {
    config.dynamicEnvironmentId = environment;
    config.dynamicAudience = '';
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/.well-known/jwks')) return Response.json({ keys: [{ ...jwk, kid: 'fixture', alg: 'RS256' }] });
      if (url.endsWith('/users')) return Response.json({ id: subject, projectEnvironmentId: environment,
        email: 'alice@example.test', verifiedCredentials: [{ format: 'email', email: 'alice@example.test' }] });
      throw new Error('Unexpected URL in auth test');
    };
    const token = await new SignJWT({ scope: 'user:basic', environment_id: environment })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setSubject(subject)
      .setIssuer(`app.dynamicauth.com/${environment}`).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const conflict = await authApp.inject({ method: 'GET', url: '/probe', headers: { authorization: `Bearer ${token}` } });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.deepEqual(conflict.json(), { error: 'identity_already_bound' });
    assert.equal(reachedRoute, false);
    assert.deepEqual((await db.query('select subject from user_auth_subjects where user_id=$1', [alice.id])).rows,
      [{ subject: 'dynamic:fixture:alice' }]);
    assert.equal((await q.getWalletForUser(alice.id))?.address, 'alice-wallet');
  } finally {
    globalThis.fetch = offlineFetch;
    config.dynamicEnvironmentId = previousEnvironment;
    config.dynamicAudience = previousAudience;
    await authApp.close();
  }
  await q.markInvitesRevealed(alice.id);
  assert.equal((await readFlist('alice@example.test')).invites.length, 3);
  await q.ensureInviteCodes(alice.id);
  assert.equal((await readFlist('alice@example.test')).invites.length, 3);
  await db.query('update invite_codes set revoked_at=now() where code=$1', [first.invites[1].code]);
  assert.equal((await readFlist('alice@example.test')).invites.length, 2);

  // Existing ordinary accounts don't bypass membership; operator consoles remain separate.
  const legacy = await q.upsertUserByPrivyDid({ privyDid: 'legacy', handle: '@legacy', email: 'legacy@example.test', walletAddress: 'legacy-wallet' });
  assert.equal((await call('GET', '/me', 'legacy')).statusCode, 403);
  assert.equal((await call('GET', '/balance', 'legacy')).statusCode, 403);
  assert.equal((await call('POST', '/prelaunch/session', 'legacy')).statusCode, 403);
  await q.joinWaitlistWithCode({ email: 'legacy@example.test', code: await mint() });
  assert.equal((await readFlist('legacy@example.test')).invites.length, 3, 'preserve account-owned allowance');
  assert.equal((await call('GET', '/me', 'legacy')).statusCode, 200);
  assert.ok(legacy.id);
  await q.upsertUserByPrivyDid({ privyDid: 'admin', handle: '@admin', email: 'admin@example.test', walletAddress: 'admin-wallet' });
  assert.equal((await call('GET', '/me', 'admin')).statusCode, 200);
  assert.equal((await call('GET', '/admin/prelaunch', 'admin')).statusCode, 200);
  assert.equal((await call('GET', '/admin/prelaunch', 'alice')).statusCode, 403);
  const partner = await q.upsertUserByPrivyDid({ privyDid: 'partner', handle: '@partner', email: 'partner@example.test', walletAddress: 'partner-wallet' });
  await db.query("insert into merchants(name, treasury_address, user_id, country) values('Test partner','partner-wallet',$1,'IN')", [partner.id]);
  assert.equal((await call('GET', '/me', 'partner')).statusCode, 200);
  assert.equal((await call('GET', '/merchants/orders', 'partner')).statusCode, 200);
  assert.equal((await call('POST', '/prelaunch/session', 'partner')).statusCode, 403, 'partner role grants no customer bypass');

  // PGlite serializes connections: tests replay semantics, not PostgreSQL lock scheduling.
  const contested = await mint();
  const attempts = await Promise.allSettled(['race-a', 'race-b'].map((name) => q.joinWaitlistWithCode({ email: `${name}@example.test`, code: contested })));
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  console.log('check-flist-access: SQL redemption, replay, privacy, account adoption, HTTP gates and console isolation passed');
} finally {
  await app.close();
  globalThis.fetch = originalFetch;
  await db.close();
}
