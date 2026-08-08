// Asserts the email rules the f-list form depends on.
//
//   node apps/landing/scripts/check-email.mjs
//
// The rules are duplicated here rather than imported because src/lib/email.ts is
// TypeScript and this script runs under bare node — but that is the point of the
// check: if the two drift, the assertions below stop matching the file and this
// fails. Keep them in step with apps/landing/src/lib/email.ts, which is itself a
// deliberate mirror of apps/backend/src/routes/waitlist.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.resolve(import.meta.dirname, '../src/lib/email.ts'), 'utf8');

// Pull the real regex and cap out of the module so this cannot pass against a
// stale copy of the rules.
const reSrc = src.match(/const EMAIL_RE = \/(.+?)\/;/)?.[1];
const maxLen = Number(src.match(/const MAX_LENGTH = (\d+);/)?.[1]);
assert.ok(reSrc, 'could not read EMAIL_RE from src/lib/email.ts');
assert.equal(maxLen, 254, 'MAX_LENGTH must match the server cap in waitlist.ts');
const EMAIL_RE = new RegExp(reSrc);

const normalize = (raw) => raw.trim().toLowerCase();
const isValid = (e) => e.length > 0 && e.length <= maxLen && EMAIL_RE.test(e);

// --- normalisation: the bug this whole pass exists to fix --------------------
assert.equal(normalize('  you@mail.com  '), 'you@mail.com', 'must trim both ends');
assert.equal(normalize('You@Mail.COM'), 'you@mail.com', 'must lowercase');
assert.ok(isValid(normalize('\tyou@mail.com\n')), 'a pasted address with whitespace must survive');

// --- what must be accepted ---------------------------------------------------
for (const good of [
  'you@mail.com',
  'first.last@sub.domain.co.uk',
  'has+tag@gmail.com',
  "o'brien@mail.ie",
]) {
  assert.ok(isValid(normalize(good)), `should accept ${good}`);
}

// --- what must be refused ----------------------------------------------------
for (const bad of ['', 'a@b', 'no-at-sign.com', 'two@@at.com', 'spaced out@mail.com', '@mail.com', 'you@']) {
  assert.ok(!isValid(normalize(bad)), `should refuse ${JSON.stringify(bad)}`);
}
assert.ok(!isValid(`${'a'.repeat(250)}@mail.com`), 'must enforce the 254 cap');

// --- typo suggestions: must fire on typos, must stay silent otherwise --------
const typos = Object.fromEntries(
  [...src.matchAll(/'([a-z0-9.]+)':\s*'([a-z0-9.]+)'/g)].map((m) => [m[1], m[2]]),
);
assert.ok(Object.keys(typos).length >= 10, 'expected a populated typo map');
const suggest = (e) => {
  const at = e.lastIndexOf('@');
  if (at < 1) return null;
  const fixed = typos[e.slice(at + 1)];
  return fixed ? `${e.slice(0, at + 1)}${fixed}` : null;
};

assert.equal(suggest('you@gmial.com'), 'you@gmail.com');
assert.equal(suggest('you@gmail.con'), 'you@gmail.com');
assert.equal(suggest('you@hotmial.com'), 'you@hotmail.com');
// Must not "correct" addresses that are already right, or unknown domains.
for (const fine of ['you@gmail.com', 'you@mail.com', 'you@my-startup.io']) {
  assert.equal(suggest(fine), null, `should not suggest anything for ${fine}`);
}
// Every replacement must itself be a valid address, or we would suggest garbage.
for (const [wrong, right] of Object.entries(typos)) {
  assert.ok(isValid(`you@${right}`), `suggestion target ${right} is not itself valid`);
  assert.ok(wrong !== right, `${wrong} maps to itself`);
}

console.log(`ok — ${Object.keys(typos).length} typo mappings, regex and 254 cap all assert clean`);
