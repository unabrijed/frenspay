import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeFunctionData, erc20Abi } from 'viem';
import { BN } from '../src/lib/units';
import { debit, grant, quoteCredits, tier } from '../src/services/prelaunch/math';
import { MONAD_USDC, withdrawal } from '../src/services/prelaunch/chain';

assert.equal(tier(false, true, true), 1);
assert.equal(tier(true, false, true), 2);
assert.equal(tier(true, true, false), 5);
assert.equal(tier(true, true, true), 10);
let g = grant('0', '100', 1, 1, '0');
assert.equal(g.increment, '100.000000');
g = grant(g.peak, '0', g.multiplier, 1, g.entitlement);
assert.equal(g.increment, '0.000000');
g = grant(g.peak, '100', g.multiplier, 1, g.entitlement);
assert.equal(g.increment, '0.000000'); // withdraw + redeposit
g = grant(g.peak, '0', g.multiplier, 2, g.entitlement);
assert.equal(g.increment, '100.000000'); // upgrade after withdrawal
g = grant(g.peak, '125', g.multiplier, 10, g.entitlement);
assert.equal(g.increment, '1050.000000');
g = grant(g.peak, '10', g.multiplier, 1, g.entitlement);
assert.equal(g.multiplier, 10);
assert.equal(g.increment, '0.000000');
assert.equal(grant('99999999999999', '0', 10, 10, '999999999999990').increment, '0.000000');
assert.equal(debit('0', '25', '12.345678').points, '0.000000');
assert.deepEqual(debit('2.123456', '25', '3'), {
  rewardRemaining: '0.000000',
  practiceRemaining: '24.123456',
  rewardUsed: '2.123456',
  practiceUsed: '0.876544',
  points: '2.123456',
});
assert.equal(debit('999999999999990', '25', '100000000000000').points, '100000000000000.000000');
for (const invalid of ['-1', 'NaN', 'Infinity', '1e6', '', '0', '0.0000001'])
  assert.throws(() => debit('10', '25', invalid));
assert.throws(() => debit('10', '25', '35.000001'));
assert.equal(quoteCredits('1.00', '1.35'), '0.740741');
assert.throws(() => quoteCredits('1.001', '1.35'));
assert.throws(() => quoteCredits('1', '0'));
// Conservation across a sequence of spends, down to the smallest unit.
let reward = '20.000000',
  practice = '25.000000',
  points = new BN(0),
  spent = new BN(0);
for (let i = 0; i < 1000; i++) {
  const d = debit(reward, practice, '0.033333');
  reward = d.rewardRemaining;
  practice = d.practiceRemaining;
  points = points.plus(d.points);
  spent = spent.plus('0.033333');
  assert.equal(new BN(reward).plus(practice).plus(spent).toFixed(6), '45.000000');
  assert.ok(points.lte(20));
}
assert.equal(points.toFixed(6), '20.000000');
const owner = '0x1111111111111111111111111111111111111111';
const destination = '0x2222222222222222222222222222222222222222';
const tx = withdrawal(destination, '1.123456', owner);
assert.equal(tx.chainId, 143);
assert.equal(tx.to, MONAD_USDC);
assert.equal(tx.value, '0x0');
const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
assert.equal(decoded.functionName, 'transfer');
assert.deepEqual(decoded.args, [destination, 1123456n]);
for (const address of ['', owner, MONAD_USDC, '0x0000000000000000000000000000000000000000'])
  assert.throws(() => withdrawal(address, '1', owner));
for (const amount of ['0', '-1', '1e3', '1.0000001'])
  assert.throws(() => withdrawal(destination, amount, owner));
assert.equal(
  readFileSync(new URL('../src/lib/paynow.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../packages/shared/src/paynow.ts', import.meta.url), 'utf8'),
  'PayNow parsers must stay identical',
);
console.log(
  'check-prelaunch: tier progression, deposit replay, precision, conservation, withdrawals and parser parity OK',
);
