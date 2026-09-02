// check-transfer-verify.ts — the second question a confirmation asks, asserted without a chain.
//
// The DB used to flip a transfer to 'confirmed' on "this signature landed". Any landed mainnet
// signature — copied off an explorer — therefore advanced an escrow order or credited a stake. The
// matcher in services/transferVerify.ts is what now stands between a signature string and a credit;
// this exercises its every branch with fabricated parsed instructions (no DB, no network —
// invariant 10). Run: yarn workspace @fpay/backend check:verify
import assert from 'node:assert/strict';

import { instructionsMove, memoOf, treasuryDepositsIn, type ParsedIx } from '../src/services/transferVerify';

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

// --- the escrow pool (docs/16) -----------------------------------------------------------------------
// A deposit is bound to its order by an SPL Memo carrying the reference, since no PDA seed does it any
// more. The RPC parses the Memo program's data as a bare string: `{ program: 'spl-memo', parsed: 'PAY-…' }`.
const POOL_OWNER = 'PoolOwner1111111111111111111111111111111111';
const memo = (text: string): ParsedIx => ({ program: 'spl-memo', parsed: text });
const deposit = { ...expect, memo: 'PAY-0000ABCD' };
check('escrow deposit: the right transfer + the right memo → matches', instructionsMove([checked(), memo('PAY-0000ABCD')], deposit));
check('escrow deposit: memo first, transfer second — order does not matter', instructionsMove([memo('PAY-0000ABCD'), checked()], deposit));
check('escrow deposit: the right transfer with NO memo → no (one deposit must name one order)', !instructionsMove([checked()], deposit));
check('escrow deposit: the right transfer under another order\'s memo → no', !instructionsMove([checked(), memo('PAY-0000FFFF')], deposit));
check('escrow deposit: a memo shaped as an object (not the memo program) does not count', !instructionsMove([checked(), { program: 'spl-memo', parsed: { type: 'memo', info: { text: 'PAY-0000ABCD' } } }], deposit));
check('a plain send is unaffected by a memo it did not ask for', instructionsMove([checked(), memo('anything')], expect));
check('memoOf: reads the string, null when absent', memoOf([checked(), memo('PAY-0000ABCD')]) === 'PAY-0000ABCD' && memoOf([checked()]) === null);

// Our OWN settlement out of the pool is checked too (needsChainCheck now includes escrow_release):
// the row's from_address is the pool OWNER — the parsed `authority` — and to_address the recipient.
const payout = { mint: MINT, destination: DEST, amount: '99999000', authority: POOL_OWNER };
check('escrow release: pool owner as authority, partner ATA as destination, amount − fee → matches',
  instructionsMove([checked({ authority: POOL_OWNER, tokenAmount: { amount: '99999000', decimals: 6 } })], payout));
check('escrow release: the fee leg in the same tx does not satisfy the partner row',
  !instructionsMove([checked({ authority: POOL_OWNER, destination: 'EarningsAta11111111111111111111111111111111', tokenAmount: { amount: '1000', decimals: 6 } })], payout));
check('escrow release: signed by the fee-payer instead of the pool → no',
  !instructionsMove([checked({ tokenAmount: { amount: '99999000', decimals: 6 } })], payout));

// --- stake claims (docs/20) --------------------------------------------------------------------------
// A partner who paid the treasury from an exchange has a row with NO sender: the verifier is pinned by
// amount + destination + the unique signature + the admin's attribution, and simply does not ask who
// signed. Every row WITH a sender is still held to it (the 'wrong authority' case above).
const claim = { mint: MINT, destination: DEST, amount: '100000000' };
check('stake claim (no expected authority): the right amount to the treasury from a stranger → matches',
  instructionsMove([checked({ authority: 'Stranger111111111111111111111111111111111111' })], claim));
check('stake claim: a multisig sender (no `authority` field at all) → matches',
  instructionsMove([checked({ authority: undefined, multisigAuthority: 'Multisig1111111111111111111111111111111111', signers: ['a', 'b'] })], claim));
check('stake claim: wrong amount still → no', !instructionsMove([checked({ tokenAmount: { amount: '99999999', decimals: 6 } })], claim));
check('stake claim: wrong destination still → no', !instructionsMove([checked({ destination: 'SomeoneElse11111111111111111111111111111111' })], claim));

// What the claim route reads off the chain at submit time: only the legs INTO the treasury count.
const other = (dest: string, amount: string) => checked({ destination: dest, tokenAmount: { amount, decimals: 6 } });
const batch = [other('Customer1111111111111111111111111111111111', '5000000'), checked(), other('Customer2222222222222222222222222222222222', '7000000'), memo('hello')];
check('treasuryDepositsIn: one treasury leg among a batched exchange withdrawal → exactly that one, with its sender',
  JSON.stringify(treasuryDepositsIn(batch, claim)) === JSON.stringify([{ amount: '100000000', sender: AUTH }]));
check('treasuryDepositsIn: two legs into the treasury (two partners in one batch) → both, for the route to refuse',
  treasuryDepositsIn([checked(), checked({ authority: 'Other111111111111111111111111111111111111111', tokenAmount: { amount: '200000000', decimals: 6 } })], claim).length === 2);
check('treasuryDepositsIn: nothing into the treasury → empty',
  treasuryDepositsIn([other('Customer1111111111111111111111111111111111', '5000000'), memo('x')], claim).length === 0);
check('treasuryDepositsIn: a plain transfer (no mint) into the treasury ATA counts; a lookalike mint on transferChecked does not',
  treasuryDepositsIn([plain()], claim).length === 1 && treasuryDepositsIn([checked({ mint: 'So11111111111111111111111111111111111111112' })], claim).length === 0);
check('treasuryDepositsIn: the sender is multisigAuthority when there is no authority',
  treasuryDepositsIn([checked({ authority: undefined, multisigAuthority: 'Multisig1111111111111111111111111111111111' })], claim)[0]?.sender === 'Multisig1111111111111111111111111111111111');
check('treasuryDepositsIn: a numeric amount is not a deposit we can credit',
  treasuryDepositsIn([plain({ amount: 100000000 })], claim).length === 0);

console.log(failures === 0 ? 'check-transfer-verify: ok' : `check-transfer-verify: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
