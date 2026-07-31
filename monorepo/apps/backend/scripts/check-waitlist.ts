// check-waitlist.ts — self-check for the f-list referral loop. Run: yarn workspace @fpay/backend check:waitlist
//
// The backend has no test framework; this is a plain assert script over the pure logic in
// routes/waitlist.ts — the parts that can rot silently because no request ever fails loudly when
// they do: a confirm token that verifies a tampered email, a ref code that isn't stable across
// re-submits (which would mint a second code for the same person), or a ref sanitiser that lets a
// path fragment into the database. Touches no network and no database.
import assert from 'node:assert/strict';

// config reads env at import, and env() prefixes by NODE_ENV — set every tier so this works however
// the shell is configured.
process.env.WAITLIST_SECRET = 'check-secret';
process.env.LOCAL_WAITLIST_SECRET = 'check-secret';
process.env.STAGE_WAITLIST_SECRET = 'check-secret';

const { refCode, confirmToken, readConfirmToken, REF_RE } = await import('../src/routes/waitlist');

const EMAIL = 'asha@example.com';

// --- confirm token: round-trips, and nothing else does ---
assert.equal(readConfirmToken(confirmToken(EMAIL)), EMAIL, 'valid token must recover its email');

// Swapping the payload for another address while keeping a real signature is THE attack this
// guards: it would confirm someone else's address, so it must not authenticate.
const [, realSig] = confirmToken(EMAIL).split('.');
const forged = `${Buffer.from('mallory@example.com').toString('base64url')}.${realSig}`;
assert.equal(readConfirmToken(forged), null, 'payload swapped under a real signature must be rejected');

assert.equal(readConfirmToken(confirmToken(EMAIL).slice(0, -1)), null, 'truncated signature must be rejected');
assert.equal(readConfirmToken(`${Buffer.from(EMAIL).toString('base64url')}.`), null, 'empty signature must be rejected');
for (const junk of ['', '.', 'nodot', 'a.b', '....']) {
  assert.equal(readConfirmToken(junk), null, `malformed token ${JSON.stringify(junk)} must be rejected, not throw`);
}
// A token whose payload decodes to something that isn't an email must never reach the HMAC compare.
assert.equal(readConfirmToken(`${Buffer.from('not-an-email').toString('base64url')}.x`), null);

// --- ref code: stable per address, distinct across addresses, URL-safe ---
assert.equal(refCode(EMAIL), refCode(EMAIL), 'same email must always yield the same code');
assert.notEqual(refCode(EMAIL), refCode('bo@example.com'), 'different emails must yield different codes');
assert.match(refCode(EMAIL), /^[a-z0-9]{8}$/, 'code must be 8 lowercase alphanumerics');
// Codes are matched by the same regex that accepts refs coming back in, or the loop never closes.
assert.ok(REF_RE.test(refCode(EMAIL)), 'a minted code must satisfy REF_RE');

// --- ref sanitiser ---
for (const ok of ['@asha', 'asha', 'k3n8q2wp', 'a', '_x_', '@a1_b2', 'a'.repeat(20)]) {
  assert.ok(REF_RE.test(ok), `${JSON.stringify(ok)} should be accepted`);
}
for (const bad of ['', '../x', 'a b', 'a'.repeat(21), '@', 'a@b.com', 'x;drop', 'ünïcode', 'a\nb', '@@a']) {
  assert.ok(!REF_RE.test(bad), `${JSON.stringify(bad)} should be rejected`);
}
// The route lowercases before testing; REF_RE itself is case-sensitive by design, so confirm the
// pairing holds rather than assuming it.
assert.ok(!REF_RE.test('@Asha'), 'REF_RE is case-sensitive — the route must lowercase first');
assert.ok(REF_RE.test('@Asha'.toLowerCase()), 'lowercased handle must pass');

console.log('check-waitlist: all assertions passed');
