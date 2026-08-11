// check-paytarget.ts — the pay-target classifier is the first thing every payment touches, and a
// wrong answer here sends money to the wrong place. Pure, no DB, no network.
//
//   yarn workspace @fpay/shared check:paytarget
//
// Lives here, not in apps/backend/scripts, because it needs the RUNTIME classifier: the backend may
// only `import type` from @fpay/shared (tsx won't transpile the workspace's raw .ts), so a backend
// script importing `classifyPayTarget` dies at module load. Same pattern as check-rails.ts.
//
// It also asserts the two backend MIRRORS of shared rules (VPA_RE in routes/orders.ts,
// HANDLE_BODY_RE in db/queries.ts) still agree — those copies exist because of that same invariant,
// and a check like this is the only thing keeping them honest.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalHandle, classifyPayTarget } from '../src/payTarget';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
let passed = 0;
const ok = (label: string) => {
  passed++;
  console.log('✓ ' + label);
};

/* ---- precedence: first match wins, and the order is load-bearing ---- */

assert.deepEqual(classifyPayTarget('@neha'), { kind: 'handle', handle: '@neha' });
assert.deepEqual(classifyPayTarget('pay:@neha'), { kind: 'handle', handle: '@neha' });
assert.deepEqual(classifyPayTarget('pay://u/@neha'), { kind: 'handle', handle: '@neha' });
assert.equal(classifyPayTarget('shop@okhdfcbank').kind, 'upi');
assert.equal(classifyPayTarget('tel:+91-98765-43210').kind, 'phone');
assert.equal(classifyPayTarget('9876543210').kind, 'phone');
ok('precedence: handle / pay: / VPA / tel: / bare phone each land on their own branch');

// A 44-char base58 string is an address, never a phone — the two ranges can't overlap, but the
// ordering is what guarantees it.
const SOL = '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj';
assert.deepEqual(classifyPayTarget(SOL), { kind: 'address', address: SOL, network: 'solana' });
assert.deepEqual(classifyPayTarget(`solana:${SOL}`), { kind: 'address', address: SOL, network: 'solana' });
const EVM = '0x2a3274c541d9b641db9275cd6806b25fab17fe00';
assert.deepEqual(classifyPayTarget(EVM), { kind: 'address', address: EVM, network: 'evm' });
ok('addresses classify to their family and survive their URI wrappers');

/* ---- the hand-rolled query parser (shared can't use URLSearchParams — see payTarget.ts) ---- */

assert.deepEqual(classifyPayTarget('upi://pay?pa=shop@okaxis&pn=Anjuna%20Cafe&am=250.50&tn=Two+coffees'), {
  kind: 'upi',
  payee: 'shop@okaxis',
  name: 'Anjuna Cafe',
  amountInr: 250.5,
  note: 'Two coffees',
});
assert.equal(classifyPayTarget('upi://pay?pn=Nameless').kind, 'unknown', 'no payee → not payable');
// A param whose NAME is a prefix of another must not match, and a malformed escape must not throw.
assert.equal((classifyPayTarget('upi://pay?pan=x&pa=shop@ybl') as { payee: string }).payee, 'shop@ybl');
assert.equal((classifyPayTarget('upi://pay?pa=shop@ybl&pn=%E0%A4') as { name?: string }).name, '%E0%A4');
assert.equal((classifyPayTarget('upi://pay?pa=shop@ybl&am=-5') as { amountInr?: number }).amountInr, undefined);
assert.equal((classifyPayTarget('upi://pay?pa=shop@ybl&am=abc') as { amountInr?: number }).amountInr, undefined);
ok('query params: decodes + and %-escapes, exact key match, survives malformed input');

/* ---- D1: a handle is REJECTED, never repaired ---- */

// The bug this replaces: the Send sheet stripped illegal characters, so "@ne-ha" became "@neha" —
// a different, real user — and every downstream confirmation showed that other person's real name.
assert.equal(canonicalHandle('@ne-ha'), null);
assert.equal(classifyPayTarget('@ne-ha').kind, 'unknown');
assert.equal(canonicalHandle('@ne ha'), null);
assert.equal(canonicalHandle('@ne/ha'), null);
ok('D1: an illegal handle is rejected, never silently rewritten into another user');

assert.equal(canonicalHandle('@Bridge '), '@bridge');
assert.equal(canonicalHandle('bridge'), '@bridge');
assert.equal(canonicalHandle('@ab'), null, '2 chars is below the backend minimum');
assert.equal(canonicalHandle('@' + 'a'.repeat(31)), null, '31 chars is above the backend maximum');
assert.equal(canonicalHandle('@' + 'a'.repeat(30)), '@' + 'a'.repeat(30));
ok('canonicalHandle: trims, lowercases, keeps the @, and holds the 3–30 bound');

/* ---- D2: an email is not a shop ---- */

// `someone@gmail.com` used to match VPA_RE, so it became a merchant target: a real quote, real
// escrow, and a merchant asked to pay an email address by hand.
// Each of these must be rejected BY THE DOT RULE, not incidentally by the local-part length bound
// that VPA_RE has always had — so every local part here is ≥2 chars.
for (const email of ['someone@gmail.com', 'first.last@yahoo.co.uk', 'ab@b.io', 'hi@fpay.xyz']) {
  assert.notEqual(classifyPayTarget(email).kind, 'upi', `${email} must not classify as a shop`);
}
// …while real PSP and bank handles still do. Every entry in UPI_HANDLES is a single dotless label.
for (const vpa of ['shop@okhdfcbank', 'john.doe@ybl', 'merchant@paytm', '9876543210@upi', 'store@icici']) {
  assert.equal(classifyPayTarget(vpa).kind, 'upi', `${vpa} must still classify as a shop`);
}
ok('D2: emails are not payable as shops; real VPAs still are');

/* ---- D3: EIP-681 never substitutes the asset ---- */

// `ethereum:<TOKEN>/transfer?address=<RECIPIENT>` means "send this token to that recipient". Taking
// the part before the '/' as the payee sent plain USDC TO THE TOKEN CONTRACT. The Solana branch has
// always guarded this; the EVM branch did not.
const tokenTransfer = `ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/transfer?address=${EVM}&uint256=1e6`;
assert.equal(classifyPayTarget(tokenTransfer).kind, 'unsupported');
assert.notEqual(classifyPayTarget(tokenTransfer).kind, 'address');
assert.equal(classifyPayTarget(`ethereum:${EVM}?value=2.014e18`).kind, 'unsupported', 'native-value request');
assert.equal(classifyPayTarget(`ethereum:${EVM}@1`).kind, 'unsupported', 'chain-qualified: refuse, never map');
assert.deepEqual(classifyPayTarget(`ethereum:${EVM}`), { kind: 'address', address: EVM, network: 'evm' });
ok('D3: EIP-681 function calls / value requests refuse; a plain address still pays');

assert.equal(classifyPayTarget(`solana:${SOL}?spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`).kind, 'unsupported');
ok('a token-pinned Solana Pay request still refuses rather than substituting USDC');

/* ---- the mirrors the backend keeps by hand ---- */

const corridors = readFileSync(join(ROOT, 'apps/backend/src/lib/corridors.ts'), 'utf8');
const shared = readFileSync(join(ROOT, 'packages/shared/src/payTarget.ts'), 'utf8');
const vpaOf = (src: string, where: string) => {
  const m = src.match(/const VPA_RE = (\/.*\/i);/);
  assert.ok(m, `could not find VPA_RE in ${where}`);
  return m![1];
};
assert.equal(
  vpaOf(corridors, 'lib/corridors.ts'),
  vpaOf(shared, 'shared/payTarget.ts'),
  'backend VPA_RE has drifted from shared — the client and the trust boundary disagree on what is payable',
);
ok('backend VPA_RE still mirrors shared');

const queries = readFileSync(join(ROOT, 'apps/backend/src/db/queries.ts'), 'utf8');
const handleRe = queries.match(/const HANDLE_BODY_RE = (\/.*\/);/);
assert.ok(handleRe, 'could not find HANDLE_BODY_RE in db/queries.ts');
assert.ok(
  shared.includes(handleRe![1].slice(1, -1)),
  'backend HANDLE_BODY_RE has drifted from shared canonicalHandle — a handle would resolve in one place and 404 in the other',
);
ok('backend HANDLE_BODY_RE still mirrors shared canonicalHandle');

console.log(`\ncheck-paytarget: ${passed}/${passed} passed`);
