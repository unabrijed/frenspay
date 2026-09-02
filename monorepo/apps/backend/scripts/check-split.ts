// check-split.ts — self-check for bill splitting. Run: yarn workspace @fpay/backend check:split
//
// Same shape as check-invites.ts: plain asserts over pure logic, no network, no database. What
// would rot silently: a sum check done in floats (0.1 + 0.2), a re-split that forgets the shares
// already paid, or a zero/negative share slipping through as "a friend who owes nothing".
import assert from 'node:assert/strict';

const { validateShares } = await import('../src/lib/split');

// The everyday case: $100 dinner, two friends, the payer keeps the rest.
let v = validateShares('100.000000', '0', [{ amountUsd: '33.33' }, { amountUsd: '33.33' }]);
assert.deepEqual(v, { ok: true, amounts: ['33.330000', '33.330000'] });

// Shares may add up to exactly the bill (the payer's part is then zero — they were treated).
v = validateShares('100.000000', '0', [{ amountUsd: '50' }, { amountUsd: '50' }]);
assert.equal(v.ok, true, 'shares equal to the bill are fine');

// One cent over is over. This is the assert that fails if the sum ever goes through Number().
v = validateShares('100.000000', '0', [{ amountUsd: '50' }, { amountUsd: '50.01' }]);
assert.deepEqual(v, { ok: false, error: 'shares_exceed_amount' });
v = validateShares('0.300000', '0', [{ amountUsd: '0.1' }, { amountUsd: '0.2' }]);
assert.equal(v.ok, true, '0.1 + 0.2 is 0.3 in money, whatever it is in floats');

// A re-split keeps what was already paid: $100 bill, $50 paid by one friend, the other cannot be
// asked for $60.
v = validateShares('100.000000', '50.000000', [{ amountUsd: '60' }]);
assert.deepEqual(v, { ok: false, error: 'shares_exceed_amount' });
v = validateShares('100.000000', '50.000000', [{ amountUsd: '50' }]);
assert.equal(v.ok, true);

// Nothing that is not a positive representable amount.
for (const bad of ['0', '-5', 'abc', '1e3', '1.1234567', '', null, undefined, {}]) {
  v = validateShares('100.000000', '0', [{ amountUsd: bad }]);
  assert.deepEqual(v, { ok: false, error: 'invalid_amount' }, `rejects ${JSON.stringify(bad)}`);
}

// An empty split is a valid "unsplit" (every open share cancelled, nothing new).
assert.deepEqual(validateShares('100.000000', '0', []), { ok: true, amounts: [] });

console.log('check-split: ok');
