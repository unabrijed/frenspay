// check-next-step — the dashboard's "do this next" card is an ORDERED decision, and the order is the
// part that regresses without anyone noticing: an exited partner has a zero bond and must not be told
// to stake; the business check precedes the stake because a human has to read one and the other is
// instant; a partner who has done both is told to flip the switch, not shown nothing.
//
// Pure: a profile in, a step out. No network, no DB. Runs in about a second like the other check:* scripts.
import assert from 'node:assert/strict';

import type { MerchantProfile } from '@fpay/shared';
import { PAYOUT_METHODS } from '@fpay/shared';

import { nextStep } from '../src/lib/nextStep';

const base: MerchantProfile = {
  id: 'm1',
  name: 'Anjuna Exchange',
  kybStatus: 'pending',
  status: 'offline',
  payoutRail: PAYOUT_METHODS[0],
  treasuryAddress: '5QGSoJM5tF7YiwGAfrrDkHC2f43bDRV9X4XgjN9Pt3ZE',
  country: 'IN',
  bondUsdc: '0',
  minBondUsdc: '100',
  floatUsdc: '0',
  maxFloatUsdc: '0',
  tier: 1,
  clawWindowHours: 72,
  spreadBps: 50,
  maxSpreadBps: 100,
  successRate: 0.99,
  disputeRate: 0.005,
  positiveRate: 0.9,
};
const at = (patch: Partial<MerchantProfile>): MerchantProfile => ({ ...base, ...patch });

// Fresh from /apply: business first, even though the stake is also missing.
assert.equal(nextStep(base)?.href, '/business');
assert.equal(nextStep(at({ bondUsdc: '250' }))?.href, '/business', 'the business check leads even when already staked');

// Sent it in, nothing staked: the stake is the next thing they can actually do while a human reads.
assert.equal(nextStep(at({ kybStatus: 'submitted' }))?.href, '/stake');
assert.equal(nextStep(at({ kybStatus: 'under_review' }))?.href, '/stake');

// Staked and waiting on us: say so, no button.
const waiting = nextStep(at({ kybStatus: 'under_review', bondUsdc: '100' }));
assert.equal(waiting?.title, 'Being reviewed');
assert.equal(waiting?.cta, undefined);

// Both done: the switch, on this card, not a route.
const ready = nextStep(at({ kybStatus: 'approved', bondUsdc: '100' }));
assert.equal(ready?.cta, 'Go online');
assert.equal(ready?.href, undefined);

// Online: nothing to do.
assert.equal(nextStep(at({ kybStatus: 'approved', bondUsdc: '100', status: 'online' })), null);

// Left fpay: bond is back at zero and approved — must NOT be asked to stake again. The row explains.
assert.equal(nextStep(at({ kybStatus: 'approved', bondUsdc: '0', status: 'suspended', suspendReason: 'exited' })), null);

// The reviewer's own words are the card when they asked for more.
const more = nextStep(at({ kybStatus: 'more_info', kybNote: 'Send the GST certificate.', bondUsdc: '100' }));
assert.equal(more?.body, 'Send the GST certificate.');
assert.equal(more?.href, '/business');

// Rejected: the reason, no button.
const no = nextStep(at({ kybStatus: 'rejected', kybNote: 'Not a registered business.', bondUsdc: '100' }));
assert.equal(no?.title, 'Not approved');
assert.equal(no?.body, 'Not a registered business.');
assert.equal(no?.cta, undefined);

// Strings never contain a decimal-string comparison slip: "900" vs "2000" floor is below, not above.
assert.equal(nextStep(at({ kybStatus: 'approved', bondUsdc: '900.000000', minBondUsdc: '2000.000000' }))?.href, '/stake');

console.log('check-next-step: ok');
