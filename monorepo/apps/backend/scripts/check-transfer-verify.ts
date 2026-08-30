// check-transfer-verify.ts — the second question a confirmation asks, asserted without a chain.
//
// The DB used to flip a transfer to 'confirmed' on "this signature landed". Any landed mainnet
// signature — copied off an explorer — therefore advanced an escrow order or credited a stake. The
// matcher in services/transferVerify.ts is what now stands between a signature string and a credit;
// this exercises its every branch with fabricated parsed instructions (no DB, no network —
// invariant 10). Run: yarn workspace @fpay/backend check:verify
import assert from 'node:assert/strict';

import { instructionsMove, type ParsedIx } from '../src/services/transferVerify';

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEST = 'DestAta1111111111111111111111111111111111111';
const AUTH = 'SenderOwner11111111111111111111111111111111';
const expect = { mint: MINT, destination: DEST, amount: '100000000', authority: AUTH };

const checked = (over: Partial<Record<string, unknown>> = {}): ParsedIx => ({
  program: 'spl-token',
  parsed: {
    type: 'transferChecked',
    info: { mint: MINT, destination: DEST, authority: AUTH, source: 'src', tokenAmount: { amount: '100000000', decimals: 6 }, ...over },
  },
});
const plain = (over: Partial<Record<string, unknown>> = {}): ParsedIx => ({
  program: 'spl-token',
  parsed: { type: 'transfer', info: { destination: DEST, authority: AUTH, source: 'src', amount: '100000000', ...over } },
});

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures++;
}

check('transferChecked of the exact amount, mint, destination, authority → matches', instructionsMove([checked()], expect));
check('plain transfer (no mint field) to the USDC ATA → matches', instructionsMove([plain()], expect));
check('found among unrelated instructions (compute budget, memo, a system transfer)', instructionsMove([
  { program: 'compute-budget', parsed: { type: 'setComputeUnitLimit', info: {} } },
  { program: 'system', parsed: { type: 'transfer', info: { destination: DEST, lamports: 5000 } } },
  checked(),
], expect));

// Every way a landed signature can still be the wrong signature.
check('wrong amount (one base unit short) → no', !instructionsMove([checked({ tokenAmount: { amount: '99999999', decimals: 6 } })], expect));
check('wrong destination → no', !instructionsMove([checked({ destination: 'SomeoneElse11111111111111111111111111111111' })], expect));
check('wrong authority (someone else paid the right person) → no', !instructionsMove([checked({ authority: 'Stranger111111111111111111111111111111111111' })], expect));
check('wrong mint on transferChecked → no', !instructionsMove([checked({ mint: 'So11111111111111111111111111111111111111112' })], expect));
check('right shape, wrong program (a fake token program) → no', !instructionsMove([{ ...checked(), program: 'spl-token-2022-lookalike' }], expect));
check('a burn, an approve, a mintTo of the right amount → no', !instructionsMove([
  { program: 'spl-token', parsed: { type: 'burn', info: { amount: '100000000', authority: AUTH } } },
  { program: 'spl-token', parsed: { type: 'approve', info: { amount: '100000000', destination: DEST } } },
  { program: 'spl-token', parsed: { type: 'mintTo', info: { amount: '100000000', account: DEST, mint: MINT } } },
], expect));
check('an empty transaction → no', !instructionsMove([], expect));
check('an unparsed (partially decoded) instruction → no, never throws', !instructionsMove([{ program: 'spl-token' }], expect));

// Amounts are compared as base-unit STRINGS: "100000000" is not 1e8 the number, and a float never
// gets near this comparison.
check('numeric amount of the right value does not match a string expectation', !instructionsMove([plain({ amount: 100000000 })], expect));

console.log(failures === 0 ? 'check-transfer-verify: ok' : `check-transfer-verify: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
