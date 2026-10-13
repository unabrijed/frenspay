// Optional isolated PostgreSQL-WASM integration check. No application DB or network is accessed.
// Install @electric-sql/pglite in a scratch directory, then set PRELAUNCH_PGLITE_MODULE to
// its absolute dist/index.js path. This adapter serializes connections; it does not prove
// multi-connection PostgreSQL row-lock behavior, which still needs staging verification.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const modulePath = process.env.PRELAUNCH_PGLITE_MODULE;
if (!modulePath) throw new Error('Set PRELAUNCH_PGLITE_MODULE to an isolated PGlite installation');
const { PGlite } = await import(modulePath);
const db = new PGlite();
await db.exec(
  readFileSync(new URL('../src/db/migrations/0031_monad_prelaunch.sql', import.meta.url), 'utf8'),
);
let queue = Promise.resolve();
async function lease() {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}
// Redirect every pg connection before importing application modules. Even a misconfigured
// local .env cannot touch an external database through this test process.
pg.Pool.prototype.connect = (async () => {
  const release = await lease();
  return { query: (sql: string, args?: unknown[]) => db.query(sql, args), release };
}) as any;
pg.Pool.prototype.query = (async (sql: string, args?: unknown[]) => {
  const release = await lease();
  try {
    return await db.query(sql, args);
  } finally {
    release();
  }
}) as any;
const { config } = await import('../src/envConfig');
Object.assign(config, {
  databaseUrl: 'postgres://isolated.invalid/test',
  isLocal: true,
  phoneOtpProvider: 'console',
  privyAppId: 'test-app',
  privyAppSecret: 'test-secret',
  monadRpcUrl: 'https://isolated.invalid/rpc',
});
let identity: any;
let observed = 100_000000n,
  chain = 143;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://isolated.invalid/rpc', 'Unexpected external network request');
  const body = JSON.parse(String(options?.body));
  const answer = (item: any) => ({
    jsonrpc: '2.0',
    id: item.id,
    result:
      item.method === 'eth_chainId'
        ? `0x${chain.toString(16)}`
        : item.method === 'eth_call'
          ? `0x${observed.toString(16).padStart(64, '0')}`
          : item.method === 'eth_getBlockByNumber'
            ? {
                number: '0x10',
                hash: '0x' + '1'.repeat(64),
                timestamp: '0x1',
                transactions: [],
                gasLimit: '0x1',
                gasUsed: '0x0',
                size: '0x1',
                difficulty: '0x0',
                totalDifficulty: '0x0',
                nonce: '0x0',
                baseFeePerGas: '0x1',
              }
            : assert.fail(item.method),
  });
  return new Response(JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)), {
    headers: { 'content-type': 'application/json' },
  });
};
const ledger = await import('../src/services/prelaunch/ledger');
const otp = await import('../src/services/phoneOtp');
const { emvCrc16 } = await import('../src/lib/paynow');
const tlv = (tag: string, value: string) => tag + String(value.length).padStart(2, '0') + value;
const raw =
  '000201' +
  tlv('26', tlv('00', 'SG.PAYNOW') + tlv('01', '2') + tlv('02', '201912345A') + tlv('03', '1')) +
  tlv('53', '702') +
  tlv('58', 'SG') +
  tlv('59', 'Test recipient') +
  '6304';
const qr = raw + emvCrc16(raw);
function person(did: string, address: string) {
  identity = {subject:did,email:did+'@example.test',walletAddress:address};
}
try {
  person('alice', '0x1111111111111111111111111111111111111111');
  let a = await ledger.syncIdentity('alice',undefined,identity);
  assert.equal(a.practiceCredits, '25.000000');
  a = await ledger.syncIdentity('alice',undefined,identity);
  assert.equal(a.practiceCredits, '25.000000');
  const practiceQuote = await ledger.makeQuote('alice', qr, '1.35');
  const first = await ledger.spend('alice', practiceQuote.id, randomUUID());
  assert.equal(first.points, '0.000000');
  a = await ledger.syncBalance('alice');
  assert.equal(a.rewardCredits, '100.000000');
  observed = 0n;
  await ledger.syncBalance('alice');
  observed = 100_000000n;
  a = await ledger.syncBalance('alice');
  assert.equal(a.rewardCredits, '100.000000');
  a = await ledger.syncIdentity('alice', { name: 'Alice', country: 'SG' },identity);
  assert.equal(a.rewardCredits, '200.000000');
  chain = 10143;
  await assert.rejects(ledger.syncBalance('alice'), /wrong_network/);
  chain = 143;
  assert.equal((await ledger.account('alice')).reward_credits, '200.000000');
  const quote = await ledger.makeQuote('alice', qr, '1.35'),
    key = randomUUID();
  const results = await Promise.all(Array.from({ length: 10 }, () => ledger.spend('alice', quote.id, key)));
  assert.ok(results.every((r) => r.id === results[0].id));
  assert.equal((await ledger.history('alice')).length, 2);
  assert.equal((await ledger.account('alice')).points, quote.credits);
  await db.query("update prelaunch_quotes set expires_at=now()-interval '1 minute' where id=$1", [quote.id]);
  assert.equal((await ledger.spend('alice', quote.id, key)).id, results[0].id);
  const tooMuch = await ledger.makeQuote('alice', qr, '10000');
  await assert.rejects(ledger.spend('alice', tooMuch.id, randomUUID()), /insufficient_credits/);
  assert.equal((await ledger.history('alice')).length, 2);
  const expired = await ledger.makeQuote('alice', qr, '1');
  await db.query("update prelaunch_quotes set expires_at=now()-interval '1 minute' where id=$1", [
    expired.id,
  ]);
  await assert.rejects(ledger.spend('alice', expired.id, randomUUID()), /quote_expired/);
  await assert.rejects(ledger.makeQuote('alice', qr, '1.001'), /invalid_amount/);
  await ledger.startPhone('alice', '+6591234567');
  const correct = otp.lastConsoleCode,
    wrong = correct === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) await assert.rejects(ledger.confirmPhone('alice', wrong), /bad_code/);
  await assert.rejects(ledger.confirmPhone('alice', correct), /too_many_attempts/);
  await db.query('update prelaunch_accounts set phone_otp_sent_at=null where id=$1', [a.id]);
  await ledger.startPhone('alice', '+6591234567');
  a = await ledger.confirmPhone('alice', otp.lastConsoleCode);
  assert.equal(a.multiplier, 5);
  identity.xSubject='alice-x';
  a = await ledger.syncIdentity('alice',undefined,identity);
  assert.equal(a.multiplier, 10);
  const bobQuote = await ledger.makeQuote('alice', qr, '1');
  person('bob', '0x2222222222222222222222222222222222222222');
  await ledger.syncIdentity('bob',undefined,identity);
  await assert.rejects(ledger.spend('bob', bobQuote.id, randomUUID()), /quote_expired/);
  await assert.rejects(ledger.startPhone('bob', '+6591234567'), /connection_already_rewarded/);
  identity.xSubject='alice-x';
  await assert.rejects(ledger.syncIdentity('bob',undefined,identity), /connection_already_rewarded/);
  assert.equal((await ledger.account('bob')).twitter_subject, null);
  const sum = (
    await db.query('select sum(amount)::text as total from prelaunch_grants where account_id=$1', [a.id])
  ).rows[0].total;
  assert.equal(sum, '1000.000000');
  console.log(
    'check-prelaunch-ledger: migration, full ledger, replay recovery, isolation, rollback, tier/identity and OTP checks OK (isolated PGlite)',
  );
} finally {
  globalThis.fetch = originalFetch;
  await db.close();
}
