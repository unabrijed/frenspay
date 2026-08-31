// check-gas-modes.ts — the two shapes a user transaction can take, asserted without a chain.
//
// Who pays gas is a deployment choice (docs/16 §Who pays gas). With a fee-payer configured, the
// backend's key is the fee payer and may create the recipient's token account inside the tx; without
// one ("sponsored mode") the tx must carry NOTHING of ours — Privy rewrites the fee payer + blockhash,
// so a backend signature or a backend-paid account creation inside the tx would fail on-chain. Both
// shapes are decided in composeUsdcTransfer (services/solana.ts), which is pure so it can be checked
// here with no RPC (invariant 10). Run: yarn workspace @fpay/backend check:gas
import assert from 'node:assert/strict';

import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Keypair, PublicKey } from '@solana/web3.js';

import { composeUsdcTransfer, MEMO_PROGRAM_ID } from '../src/services/solana';

const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const from = Keypair.generate().publicKey;
const to = Keypair.generate().publicKey;
const payer = Keypair.generate().publicKey;
const base = { fromOwner: from, toOwner: to, mint, amountBase: 1_000_000n, decimals: 6 };
const programs = (tx: { instructions: { programId: PublicKey }[] }) => tx.instructions.map((ix) => ix.programId.toBase58());

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name} — ${(e as Error).message}`);
    failures++;
  }
}

check('fee-payer mode: our key is the fee payer, and creates a missing recipient account inside the tx', () => {
  const tx = composeUsdcTransfer({ ...base, recipientAtaMissing: true, payer });
  assert.equal(tx.feePayer?.toBase58(), payer.toBase58());
  assert.deepEqual(programs(tx), [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), TOKEN_PROGRAM_ID.toBase58()]);
});
check('fee-payer mode: an existing recipient account ⇒ just the transfer', () => {
  const tx = composeUsdcTransfer({ ...base, recipientAtaMissing: false, payer });
  assert.deepEqual(programs(tx), [TOKEN_PROGRAM_ID.toBase58()]);
});
check('sponsored mode: the SENDER is the placeholder fee payer and nothing of ours is inside', () => {
  const tx = composeUsdcTransfer({ ...base, recipientAtaMissing: false });
  assert.equal(tx.feePayer?.toBase58(), from.toBase58(), 'the placeholder Privy replaces is the sender');
  assert.deepEqual(programs(tx), [TOKEN_PROGRAM_ID.toBase58()]);
  assert.equal(tx.signatures.length, 0, 'no backend signature — Privy would invalidate it');
});
check('sponsored mode: a missing recipient account is refused here (it must be created first, in its own tx)', () => {
  assert.throws(() => composeUsdcTransfer({ ...base, recipientAtaMissing: true }), /must exist before/);
});
check('the memo rides last, in both modes', () => {
  for (const p of [payer, undefined]) {
    const tx = composeUsdcTransfer({ ...base, recipientAtaMissing: false, payer: p, memo: 'PAY-0000ABCD' });
    assert.equal(programs(tx).at(-1), MEMO_PROGRAM_ID.toBase58());
  }
});

console.log(failures === 0 ? 'check-gas-modes: ok' : `check-gas-modes: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
