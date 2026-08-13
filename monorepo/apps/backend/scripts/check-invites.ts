// check-invites.ts — self-check for invite code minting. Run: yarn workspace @fpay/backend check:invites
//
// Same shape as check-waitlist.ts: plain asserts over pure logic, no network, no database. What
// rots silently here is exactly what nothing else would catch — a mint that quietly narrows its
// alphabet (collapsing the keyspace that IS the gate's security), or a canonicaliser that maps two
// different codes onto one, which would let one person's invite redeem another's.
import assert from 'node:assert/strict';

const { mintCode, canonicalInviteCode, inviteRequired, INVITES_PER_USER } = await import(
  '../src/services/invites'
);

// --- shape ---
const SHAPE = /^FP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
for (let i = 0; i < 500; i++) {
  assert.match(mintCode(), SHAPE, 'every minted code must match the canonical shape');
}
assert.equal(INVITES_PER_USER, 3, 'three frens, per the product decision');

// The ambiguous characters are the whole point of the alphabet choice — if any of them ever appear
// in output, someone widened ALPHABET and reintroduced "is that a 1 or an I?" support tickets.
const AMBIGUOUS = ['I', 'L', 'O', 'U'];
const sample = Array.from({ length: 2000 }, mintCode).join('');
for (const ch of AMBIGUOUS) {
  assert.ok(!sample.includes(ch), `minted codes must never contain ${ch}`);
}

// --- entropy: a mint that repeats is a mint that isn't random ---
const minted = new Set(Array.from({ length: 10_000 }, mintCode));
assert.equal(minted.size, 10_000, '10k mints must all be distinct');

// Every symbol should actually show up across a large sample. Catches a masking bug (e.g. `b & 15`)
// that would halve the keyspace while still producing codes that look fine.
for (const ch of '0123456789ABCDEFGHJKMNPQRSTVWXYZ') {
  assert.ok(sample.includes(ch), `alphabet symbol ${ch} never appeared — keyspace is narrower than declared`);
}

// --- canonicalisation: every way a human might type one code lands on the same string ---
const CANON = 'FP-7K2M-QXWD';
for (const typed of [
  'FP-7K2M-QXWD',
  'fp-7k2m-qxwd',
  'FP7K2MQXWD',
  '7K2MQXWD',
  '7k2mqxwd',
  '  fp 7k2m qxwd  ',
  'fp_7k2m_qxwd',
  'FP-7K2M-QXWD\n',
]) {
  assert.equal(canonicalInviteCode(typed), CANON, `${JSON.stringify(typed)} must canonicalise to ${CANON}`);
}

// Crockford's forgiving decode: I and L are 1, O is 0. Folding these is safe precisely because
// they are not in the alphabet, so no real code can collide with a folded one.
assert.equal(canonicalInviteCode('FP-IK2M-QXWD'), 'FP-1K2M-QXWD', 'I folds to 1');
assert.equal(canonicalInviteCode('FP-LK2M-QXWD'), 'FP-1K2M-QXWD', 'L folds to 1');
assert.equal(canonicalInviteCode('FP-OK2M-QXWD'), 'FP-0K2M-QXWD', 'O folds to 0');

// A body may legitimately begin with 'FP'. Stripping it by pattern rather than by length would
// eat four real characters and silently reject a valid code.
assert.equal(canonicalInviteCode('FPQXWD23'), 'FP-FPQX-WD23', 'a bare 8-char body starting FP is a body, not a prefix');
assert.equal(canonicalInviteCode('FP-FPQX-WD23'), 'FP-FPQX-WD23', 'and it round-trips once prefixed');

// --- rejection ---
for (const bad of [
  '',
  'FP',
  '7K2MQXW', // 7 chars
  '7K2MQXWD9', // 9 chars
  'FP-7K2M-QXWDEF', // body too long even after the prefix
  'UUUUUUUU', // U is excluded and has nothing to fold to
  '7K2MQXWU',
  '../../etc',
  'DROP TABLE',
]) {
  assert.equal(canonicalInviteCode(bad), null, `${JSON.stringify(bad)} must be rejected`);
}
// Never throws on junk input — this runs on an unauthenticated route.
for (const junk of [null, undefined, 42, {}, []] as unknown[]) {
  assert.equal(canonicalInviteCode(junk as string), null, 'non-string input must return null, not throw');
}

// Round trip: everything mintCode produces must survive canonicalisation unchanged.
for (let i = 0; i < 1000; i++) {
  const code = mintCode();
  assert.equal(canonicalInviteCode(code), code, 'a minted code must be its own canonical form');
}

// --- who has to spend a code ---
// The door itself. Every carve-out here is one the gate would otherwise close on someone who must
// get through; the last assert is the one that matters, because a bypass that widens is a directory
// that is no longer invite-only.
const OPEN = { isExistingUser: false, directoryHasUsers: true, isRootAdmin: false };
assert.equal(inviteRequired(OPEN), true, 'an ordinary new signup on a populated directory needs a code');
assert.equal(
  inviteRequired({ ...OPEN, isExistingUser: true }),
  false,
  'an existing user re-syncing already paid, whenever they joined',
);
assert.equal(
  inviteRequired({ ...OPEN, directoryHasUsers: false }),
  false,
  'an empty directory founds itself, or nobody can ever be first',
);
assert.equal(
  inviteRequired({ ...OPEN, isRootAdmin: true }),
  false,
  'a root admin walks in — ADMIN_EMAILS is the recovery path, and codes are minted from the console it recovers',
);
// Root admin is the ONLY thing that opens the door for a stranger. If a fourth field ever does too,
// it should have to be written here first.
assert.equal(
  inviteRequired({ isExistingUser: false, directoryHasUsers: true, isRootAdmin: false }),
  true,
  'nothing else may skip the gate',
);

console.log('check-invites: ok');
