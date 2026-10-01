// Offline contract tests: no credentials, network, database or real payment state.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { registerStraitsxSandboxWebhook } from '../src/routes/straitsxSandboxWebhook';
import {
  makeStraitsxSandboxClient, makeStraitsxSandboxPayout, STRAITSX_SANDBOX_URL,
  type SandboxInitiate,
} from '../src/services/payout/providers/straitsxSandbox';

const input: SandboxInitiate = { reference: 'sandbox-ONE', currency: 'SGD', amountFiat: '1.25',
  destination: { proxyType: 'uen', proxyValue: '201411660R' }, name: 'Sandbox Shop' };
const fixture = (status = 'pending', overrides: Record<string, unknown> = {}) => ({ data: {
  id: 'contract_ONE', type: 'paynowTransaction', attributes: {
    idempotencyId: input.reference, amount: '1.25', status, disbursementMethod: input.destination,
    externalReference: input.reference, ...overrides,
  },
} });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const missing = () => response({}, 404);
const recipient = () => response({ data: { id: 'recipient_ONE', type: 'payoutRecipient', attributes: {} } }, 201);
type Step = Response | Error;
function harness(steps: Step[]) {
  const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
  const client = makeStraitsxSandboxClient({ apiKey: 'sandbox-test-key', fetch: async (url, init) => {
    assert.ok(String(url).startsWith(STRAITSX_SANDBOX_URL + '/'), 'only sandbox host');
    assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>)['X-XFERS-APP-API-KEY'], 'sandbox-test-key');
    assert.ok(init?.signal, 'bounded request');
    calls.push({ url: String(url), init: init!, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = steps.shift();
    assert.ok(next, 'unexpected API request');
    if (next instanceof Error) throw next;
    return next;
  } });
  return { client, calls, adapter: makeStraitsxSandboxPayout(client, 'customer_profile_TEST'), done: () => assert.equal(steps.length, 0) };
}

for (const key of ['', ' ', '<your key>', 'your-api-key']) assert.throws(() => makeStraitsxSandboxClient({ apiKey: key }));
{
  const h = harness([missing(), recipient(), response(fixture(), 201), response(fixture())]);
  const [first, concurrent] = await Promise.all([h.adapter.initiate(input), h.adapter.initiate(input)]);
  assert.equal(first.providerRef, concurrent.providerRef);
  assert.equal((await h.adapter.initiate(input)).providerRef, first.providerRef);
  assert.equal(h.calls.filter((c) => c.init.method === 'POST').length, 2, 'only one recipient and one payout');
  const recipientInfo = h.calls[1].body.data.attributes.recipientInformation;
  assert.equal(recipientInfo.entityType, 'business');
  assert.equal(recipientInfo.currency, 'SGD');
  assert.equal(recipientInfo.proxyType, 'uen');
  const payoutBody = h.calls[2].body.data.attributes;
  assert.equal(payoutBody.idempotencyId, input.reference);
  assert.equal(payoutBody.amount, 1.25);
  assert.equal(payoutBody.payoutRecipient.walletSource, 'sgd', 'do not silently default to XSGD');
  assert.equal(payoutBody.payoutRecipient.disbursementMethod, 'paynow');
  h.done();
}
{
  const h = harness([recipient()]);
  await h.client.createRecipient('customer_profile_TEST', { proxyType: 'mobile_number', proxyValue: '+6588889999' }, 'Sandbox Person');
  assert.equal(h.calls[0].body.data.attributes.recipientInformation.entityType, 'individual');
  h.done();
}
// Restart/retry recovery uses the SAME key, even when the POST committed but its response was lost.
for (const ambiguous of [new Error('timeout'), response({}, 409), response({}, 500), new Response('not JSON', { status: 201 })]) {
  const h = harness([missing(), recipient(), ambiguous, response(fixture('completed'))]);
  assert.equal((await h.adapter.initiate(input)).status, 'paid');
  assert.equal(h.calls.filter((c) => c.url.endsWith('/payouts')).length, 1, 'never replace an ambiguous payout');
  assert.ok(h.calls[3].url.endsWith('/payouts/sandbox-ONE'));
  h.done();
}
{
  const h = harness([missing(), recipient(), new Error('timeout'), missing()]);
  await assert.rejects(h.adapter.initiate(input), /unresolved/);
  h.done();
}
for (const [vendor, ours] of [['completed', 'paid'], ['failed', 'failed'], ['pending', 'pending'], ['reversed', 'pending'], ['NEW_STATUS', 'pending']]) {
  const h = harness([response(fixture(vendor))]);
  assert.equal((await h.adapter.check(input.reference)).status, ours);
  h.done();
}
{
  const h = harness([missing(), response({}, 401), response({}, 429), response({}, 500), response({}), response(fixture('completed', { amount: '1.251' }))]);
  assert.equal((await h.adapter.check(input.reference)).status, 'pending', '404 is not terminal failure');
  for (let i = 0; i < 5; i++) await assert.rejects(h.adapter.check(input.reference));
  h.done();
}
for (const overrides of [{ amount: '2.00' }, { disbursementMethod: { proxyType: 'mobile_number', proxyValue: '+6588889999' } },
  { idempotencyId: 'sandbox-OTHER' }, { externalReference: 'OTHER-INVOICE' }]) {
  const h = harness([response(fixture('completed', overrides))]);
  await assert.rejects(h.adapter.initiate(input), /conflicts/);
  assert.equal(h.calls.length, 1, 'conflicting reference must not create anything');
}
{
  const h = harness([]);
  for (const amountFiat of ['0', '-1', '1.001', '200000.01', '1e2', 'NaN']) {
    await assert.rejects(h.adapter.initiate({ ...input, amountFiat }));
  }
  await assert.rejects(h.adapter.initiate({ ...input, currency: 'USD' as 'SGD' }));
  await assert.rejects(h.adapter.initiate({ ...input, reference: '../orders/123' }));
  await assert.rejects(h.adapter.initiate({ ...input, name: '' }));
  await assert.rejects(h.adapter.initiate({ ...input, externalReference: ' ' }));
  await assert.rejects(h.adapter.initiate({ ...input, destination: { proxyType: 'mobile_number', proxyValue: '+918888999999' } }));
  assert.equal(h.calls.length, 0);
}
{
  const h = harness([missing(), recipient(), response(fixture(), 201)]);
  const mutable = { ...input, destination: { ...input.destination } };
  const pending = h.adapter.initiate(mutable);
  mutable.destination.proxyValue = '201411661R';
  await assert.rejects(h.adapter.initiate({ ...input, amountFiat: '2.00' }), /concurrent reference conflict/);
  assert.equal((await pending).destination.proxyValue, input.destination.proxyValue, 'input was snapshotted before network awaits');
  h.done();
}
{
  const h = harness([response({ data: { id: 'customer_profile_TEST', type: 'customer_profile', attributes: {} } }),
    response({}), response({}), response({})]);
  const id = await h.client.createCustomerProfile({ customerName: 'Sandbox Test', registrationType: 'personal',
    registrationIdType: 'passport', registrationIdCountry: 'SG', registrationId: 'SYNTHETIC123',
    dateOfBirth: '1990-01-01', nationality: 'SG', countryOfResidence: 'SG', merchantRef: 'sandbox-test',
    address: { street: '1 Sandbox Street', city: 'Singapore', country: 'SG' } });
  await h.client.simulateProfileVerified(id);
  await h.client.topUpVirtualSgd('10');
  await h.client.simulatePayoutStatus(id, 'contract_ONE', 'failed');
  assert.equal(h.calls[0].body.registrationType, 'personal', 'CP endpoint uses a flat body');
  assert.equal(h.calls[1].init.method, 'PUT');
  assert.deepEqual(h.calls[2].body.data.attributes, { currency: 'SGD', amount: '10.00' });
  assert.equal(h.calls[3].init.method, 'PUT');
  h.done();
}

// Real Fastify injection proves raw-body verification and parser encapsulation, not just HMAC math.
const secret = 'sandbox-signing-test';
const app = Fastify();
await registerStraitsxSandboxWebhook(app, secret);
app.post('/existing-json-route', async (req) => req.body);
const url = '/webhooks/straitsx/straitsx_sg_sandbox';
const body = '{ "data": {"id":"contract_ONE", "attributes":{"status":"completed"}} }';
const signature = createHmac('sha256', secret).update(body).digest('hex');
for (const invalid of [undefined, '0'.repeat(64), 'bad', [signature, signature]]) {
  const res = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', ...(invalid ? { 'xfers-signature': invalid } : {}) }, payload: body });
  assert.equal(res.statusCode, 401);
}
for (let repeat = 0; repeat < 2; repeat++) {
  const res = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', 'xfers-signature': signature }, payload: body });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, sandboxOnly: true });
}
assert.equal((await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', 'xfers-signature': signature }, payload: body.replace('completed', 'failed') })).statusCode, 401);
assert.equal((await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', 'xfers-signature': createHmac('sha256', secret).update('{').digest('hex') }, payload: '{' })).statusCode, 400);
assert.equal((await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: 'x'.repeat(70_000) })).statusCode, 413);
assert.deepEqual((await app.inject({ method: 'POST', url: '/existing-json-route', payload: { unchanged: true } })).json(), { unchanged: true });
await app.close();
const noSecret = Fastify();
await registerStraitsxSandboxWebhook(noSecret, '');
assert.equal((await noSecret.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', 'xfers-signature': signature }, payload: body })).statusCode, 401);
await noSecret.close();
console.log('check-straitsx-sandbox: API contracts, retry recovery, idempotency, status mapping and raw callbacks passed (offline)');
