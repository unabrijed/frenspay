import assert from 'node:assert/strict';
import { allocateExpense, rankPeople, settleExpense } from '../src/lib/expenses';
import { BN } from '../src/lib/units';
import { smsInviteUrl } from '../src/lib/sms';
import { readFileSync } from 'node:fs';
for (const name of ['expenses.ts', 'sms.ts'])
  assert.equal(
    readFileSync(new URL(`../src/lib/${name}`, import.meta.url), 'utf8'),
    readFileSync(new URL(`../../../packages/shared/src/${name}`, import.meta.url), 'utf8'),
    `${name} must stay byte-identical`,
  );

const shares = allocateExpense('100', ['a', 'b', 'c'], 'a');
assert.deepEqual(Object.fromEntries(shares), { b: '33.330000', c: '33.330000', a: '33.340000' });
assert.equal(allocateExpense('100.000001', ['a', 'b', 'c'], 'a').get('a'), '33.340001');
assert.equal(
  allocateExpense(
    '100',
    ['a', 'b', 'c'],
    'a',
    new Map([
      ['b', '20'],
      ['c', '33.33'],
    ]),
  ).get('a'),
  '46.670000',
);
assert.equal(allocateExpense('100', ['a', 'b'], 'a', new Map([['b', '100']])).get('a'), '0.000000');
assert.throws(() => allocateExpense('100', ['a', 'b'], 'a', new Map([['b', '100.01']])), /shares_exceed_amount/);
assert.throws(() => allocateExpense('100', ['a', 'b', 'b'], 'a'), /invalid_participants/);
for (const value of ['-1', 'NaN', '1e2', '0.0000001', '1,000', ''])
  assert.throws(() => allocateExpense(value, ['a'], 'a'), /invalid_amount/);
assert.deepEqual(
  settleExpense([
    { userId: 'a', shareUsd: '40', paidUsd: '90' },
    { userId: 'b', shareUsd: '40', paidUsd: '30' },
    { userId: 'c', shareUsd: '40', paidUsd: '0' },
  ]),
  [
    { fromUserId: 'c', toUserId: 'a', amountUsd: '40.000000' },
    { fromUserId: 'b', toUserId: 'a', amountUsd: '10.000000' },
  ],
);
const many = [
  { userId: 'a', shareUsd: '30', paidUsd: '70' },
  { userId: 'b', shareUsd: '30', paidUsd: '50' },
  { userId: 'c', shareUsd: '30', paidUsd: '0' },
  { userId: 'd', shareUsd: '30', paidUsd: '0' },
];
assert.deepEqual(settleExpense(many), settleExpense([...many].reverse()), 'deterministic across DB row order');
assert.equal(
  settleExpense(many)
    .reduce((n, e) => n.plus(e.amountUsd), new BN(0))
    .toFixed(6),
  '60.000000',
);
assert.throws(() => settleExpense([{ userId: 'a', shareUsd: '1', paidUsd: '0' }]), /unbalanced_expense/);
const signal = { trip: false, favorite: false, routineCount: 0, count: 1, lastAt: 1 };
assert.deepEqual(
  rankPeople([
    { ...signal, userId: 'recent', lastAt: 4 },
    { ...signal, userId: 'routine', routineCount: 3 },
    { ...signal, userId: 'favorite', favorite: true },
    { ...signal, userId: 'trip', trip: true },
  ]).map((p) => p.userId),
  ['trip', 'favorite', 'routine', 'recent'],
);
assert.equal(smsInviteUrl('+6591234567', 'Join & split?'), 'sms:+6591234567?body=Join%20%26%20split%3F');
assert.equal(smsInviteUrl('+6591234567', 'Join', true), 'sms:+6591234567&body=Join');
for (const invalid of ['sms:+6512345678', '+6512345678,+6512345679', '123', '+65?body=attack'])
  assert.throws(() => smsInviteUrl(invalid, 'Join'));
console.log('check-expenses: allocation, settlement, ranking, and SMS encoding passed');
