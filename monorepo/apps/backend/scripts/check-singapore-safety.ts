// Exercises real route/registry/confirm/worker functions against a FAIL-CLOSED in-memory SQL stub.
// No real database, HTTP or chain access. An unexpected query/connection/request fails the check.
import assert from 'node:assert/strict';
import pg from 'pg';
import Fastify from 'fastify';

process.env.NODE_ENV = 'stage';
process.env.STAGE_DATABASE_URL = 'postgresql://offline:offline@sandbox-test.invalid/offline';
process.env.STAGE_ESCROW_SECRET_KEY = '';
process.env.STAGE_FEE_PAYER_SECRET_KEY = '';
process.env.STAGE_PLATFORM_FEE_DESTINATION = '';
process.env.PRIVY_APP_ID = '';
process.env.PRIVY_APP_SECRET = '';
process.env.STAGE_STRAITSX_SANDBOX_API_KEY = 'sandbox-test-key';
const originalQuery = pg.Pool.prototype.query;
const originalConnect = pg.Pool.prototype.connect;
const originalFetch = globalThis.fetch;
type Result = { rows: any[]; rowCount: number };
let calls: string[] = [];
let answer: (sql: string, params: unknown[]) => Result = () => { throw new Error('Unexpected SQL'); };
pg.Pool.prototype.query = (async function (sql: string, params: unknown[] = []) {
  assert.equal(typeof sql, 'string');
  calls.push(sql);
  return answer(sql, params);
}) as typeof pg.Pool.prototype.query;
pg.Pool.prototype.connect = (async () => { throw new Error('Real DB connection forbidden'); }) as unknown as typeof pg.Pool.prototype.connect;
globalThis.fetch = async () => { throw new Error('Network/chain access forbidden'); };

try {
  const { config } = await import('../src/envConfig');
  // Test the dangerous configuration: real escrow is enabled and a sandbox key is present.
  config.escrowLive = true;
  const { payoutProviderFor, payoutProviderById, providerHasCredentials } = await import('../src/services/payout/provider');
  const { CORRIDORS, acceptsLps, NOT_QUOTABLE } = await import('../src/lib/corridors');
  const { isSandboxPayoutProvider } = await import('../src/services/payout/providers/straitsxSandbox');
  assert.equal(CORRIDORS.PayNow, undefined);
  assert.ok(NOT_QUOTABLE.includes('PayNow'));
  assert.equal(acceptsLps('PayNow'), false);
  assert.equal(await payoutProviderFor('PayNow'), null);
  assert.equal(calls.length, 0, 'no wildcard sim lookup for Singapore');
  const row = { id: 'straitsx_sg_sandbox', adapter: 'straitsx_sandbox', payout_method: 'PayNow', priority: 1, enabled: true };
  assert.equal(providerHasCredentials(row), true, 'credentials present is not activation');
  for (const candidate of [row, { ...row, adapter: 'sim', payout_method: '*' },
    { ...row, id: 'renamed' }, { ...row, id: 'renamed', adapter: 'sim' }]) {
    assert.ok(isSandboxPayoutProvider(candidate));
    answer = (sql) => { assert.match(sql, /from payout_providers/); return { rows: [candidate], rowCount: 1 }; };
    assert.equal(await payoutProviderById(candidate.id), null, 'sticky recovery cannot load sandbox');
    assert.equal(await payoutProviderFor('UPI'), null, 'wildcard sandbox cannot reach other rails either');
  }

  const { registerOrderRoutes } = await import('../src/routes/orders');
  const orders = Fastify();
  orders.addHook('preHandler', async (req) => { req.userId = 'user_TEST'; });
  await registerOrderRoutes(orders);
  calls = [];
  answer = () => { throw new Error('Quote must fail before any SQL'); };
  const quote = await orders.inject({ method: 'POST', url: '/orders/quote', payload: {
    payoutMethod: 'PayNow', direction: 'spend', amountInr: 10, payoutDestination: '+6588889999',
  } });
  assert.equal(quote.statusCode, 400);
  assert.equal(quote.json().error, 'unsupported_payout_method');
  assert.equal(calls.length, 0);
  await orders.close();

  const { confirmOrderFromQuote } = await import('../src/services/orderMachine');
  answer = (sql) => {
    assert.match(sql, /from quotes where id/);
    return { rows: [{ id: 'quote_TEST', payout_method: 'PayNow', merchant_id: null, amount_usdc: '10.00',
      platform_fee_usdc: '0.001000', legs: null, expires_at: new Date(Date.now() + 60_000) }], rowCount: 1 };
  };
  calls = [];
  assert.deepEqual(await confirmOrderFromQuote('user_TEST', 'quote_TEST'), { error: 'unsupported_payout_method' });
  assert.equal(calls.length, 1, 'confirm stops before wallet lookup, transfers, or escrow construction');

  const { registerAdminRoutes } = await import('../src/routes/admin');
  const admin = Fastify();
  admin.addHook('preHandler', async (req) => { req.userId = 'admin_TEST'; });
  await registerAdminRoutes(admin);
  answer = (sql) => {
    if (/from users/.test(sql)) return { rows: [{ id: 'admin_TEST', role: 'admin' }], rowCount: 1 };
    if (/from payout_providers/.test(sql)) return { rows: [row], rowCount: 1 };
    throw new Error('Admin must not write to enable a sandbox provider');
  };
  const listing = await admin.inject({ method: 'GET', url: '/admin/payout-providers' });
  assert.equal(listing.statusCode, 200);
  assert.equal(listing.json().providers[0].sandboxOnly, true);
  const enable = await admin.inject({ method: 'POST', url: '/admin/payout-providers/straitsx_sg_sandbox', payload: { enabled: true } });
  assert.equal(enable.statusCode, 409);
  assert.equal(enable.json().error, 'provider_sandbox_only');
  await admin.close();

  const { runOrderWorkerOnce } = await import('../src/services/simMerchant');
  for (const state of ['payment_detected', 'merchant_confirms']) {
    calls = [];
    answer = (sql, params) => {
      if (sql.includes('m.treasury_address, m.user_id as merchant_user_id')) {
        return { rows: [{ id: 'order_TEST', user_id: 'user_TEST', reference_code: 'sandbox-TEST', state,
          resolution: null, amount_usdc: '10', updated_at: new Date(0), expires_at: new Date(0),
          payout_method: 'PayNow', payout_provider_id: 'straitsx_sg_sandbox', payout_providers_tried: [],
          payout_claimed_at: new Date(0), sim_behavior: 'psp', treasury_address: 'would-release-if-unguarded',
        }], rowCount: 1 };
      }
      // Worker housekeeping may expire abandoned orders/locks; no matching fixtures.
      if (sql.includes("where state = 'pay_instructions'") || sql.includes('set locked_at = null, lock_expires_at = null')) return { rows: [], rowCount: 0 };
      if (/^update orders set updated_at = now\(\), resolution =/.test(sql)) {
        assert.ok(params.includes('under_review')); return { rows: [], rowCount: 1 };
      }
      if (/insert into (order_events|risk_events)/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected worker SQL: ${sql.slice(0, 100)}`);
    };
    const logs: string[] = [];
    await runOrderWorkerOnce((message) => logs.push(message));
    assert.ok(calls.some((sql) => /update orders set updated_at = now\(\), resolution =/.test(sql)), 'worker freezes even already-claimed Singapore order');
    assert.equal(logs.some((message) => /error|failed/i.test(message)), false, logs.join('\n'));
    assert.equal(calls.some((sql) => /insert into transfers/.test(sql)), false);
  }
  console.log('check-singapore-safety: live escrow + credentials + enabled rows still cannot activate Singapore (offline)');
} finally {
  pg.Pool.prototype.query = originalQuery;
  pg.Pool.prototype.connect = originalConnect;
  globalThis.fetch = originalFetch;
}
