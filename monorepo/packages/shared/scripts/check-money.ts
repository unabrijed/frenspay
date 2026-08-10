// check-money.ts — the money convention is the one place a silent bug moves real value. Every
// assert here is a failure that already happened once, or would have. Pure, no DB, no network.
//
//   yarn check:money
//
// Lives here, not in apps/backend/scripts, for the same reason as check-paytarget.ts: it needs the
// RUNTIME helpers, and the backend may only `import type` from @fpay/shared. It also asserts the
// backend MIRROR of units.ts hasn't drifted, and that nobody has taught `pg` to hand back floats.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BN,
  divDown,
  divUp,
  formatAmount,
  fromBaseUnits,
  INR_DECIMALS,
  normalizeAmount,
  parseAmount,
  RATE_DECIMALS,
  toBaseUnits,
  USDC_DECIMALS,
} from '../src/units';
import { inrRaw } from '../src/money';
// The backend's wire-number seam. Imported across the workspace boundary on purpose: the rounding
// law is one law, and it must hold on both sides of it.
import { amt, roundDown, roundUp } from '../../../apps/backend/src/lib/amount';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
let passed = 0;
const ok = (label: string) => {
  passed++;
  console.log('✓ ' + label);
};
const throws = (fn: () => unknown, label: string) => assert.throws(fn, undefined, label);

/* ---- round-trip: parse then format is the identity, so string equality means equality ---- */

for (const s of ['0.000001', '1.000000', '25.000000', '5.711023', '99999999999999.999999']) {
  assert.equal(formatAmount(parseAmount(s, USDC_DECIMALS), USDC_DECIMALS), s);
}
assert.equal(formatAmount(parseAmount('25', USDC_DECIMALS), USDC_DECIMALS), '25.000000', 'canonicalizes');
assert.equal(formatAmount(parseAmount('500', INR_DECIMALS), INR_DECIMALS), '500.00');
ok('parse → format round-trips, and canonicalizes to fixed dp');

/* ---- rejection, not rounding. Each of these silently corrupted an amount before. ---- */

throws(() => parseAmount('0.1234567891', USDC_DECIMALS), '10dp was silently truncated to 6');
throws(() => parseAmount('1e5', USDC_DECIMALS), 'exponent notation parses as 100000 in BigNumber');
throws(() => parseAmount('abc', USDC_DECIMALS), 'new BigNumber("abc") is NaN — it does NOT throw');
throws(() => parseAmount('NaN', USDC_DECIMALS), 'same trap, spelled out');
throws(() => parseAmount('Infinity', USDC_DECIMALS), 'same trap');
throws(() => parseAmount('-5', USDC_DECIMALS), 'amounts are unsigned; direction is a column, not a sign');
throws(() => parseAmount('', USDC_DECIMALS), 'empty');
throws(() => parseAmount(' 5', USDC_DECIMALS), 'whitespace');
throws(() => parseAmount('.5', USDC_DECIMALS), 'bare fraction');
throws(() => parseAmount('5.', USDC_DECIMALS), 'trailing point');
throws(() => parseAmount(undefined as unknown as string, USDC_DECIMALS), 'missing field');
throws(() => parseAmount('100000000000000', USDC_DECIMALS), '1e14 overflows numeric(20,6) → SQLSTATE 22003');
ok('parseAmount refuses everything it cannot represent exactly');

/* ---- the trust boundary: what routes actually receive ---- */

assert.equal(normalizeAmount('25', USDC_DECIMALS), '25.000000');
assert.equal(normalizeAmount(25, USDC_DECIMALS), '25.000000', 'legacy number wire still works');
throws(() => normalizeAmount(1e-9, USDC_DECIMALS), '1e-9 passed `> 0` and became 0 base units');
throws(() => normalizeAmount(1e308, USDC_DECIMALS), '"1e+308" reached Postgres as a 500');
throws(() => normalizeAmount(NaN, USDC_DECIMALS), '');
throws(() => normalizeAmount(0.1234567891, USDC_DECIMALS), '');
throws(() => normalizeAmount(null, USDC_DECIMALS), '');
throws(() => normalizeAmount({ amount: 5 }, USDC_DECIMALS), '');
ok('normalizeAmount rejects every value that used to reach the ledger');

/* ---- no exponential notation ever leaves the module (a "1e-7" is not a numeric literal) ---- */

assert.equal(formatAmount(parseAmount('0.000001', USDC_DECIMALS), USDC_DECIMALS), '0.000001');
assert.ok(!formatAmount(parseAmount('99999999999999', USDC_DECIMALS), USDC_DECIMALS).includes('e'));
assert.ok(!formatAmount(fromBaseUnits(1n, 18), 18).includes('e'), '1 wei at 18dp');
ok('EXPONENTIAL_AT is disabled — no "1e-7" can reach Postgres or the wire');

/* ---- the rounding law: user owes → up, fpay delivers → down. The two must differ. ---- */

const inr = parseAmount('500', INR_DECIMALS);
const rate = parseAmount('87.5500', RATE_DECIMALS);
assert.equal(formatAmount(divUp(inr, rate, USDC_DECIMALS), USDC_DECIMALS), '5.711023');
assert.equal(formatAmount(divDown(inr, rate, USDC_DECIMALS), USDC_DECIMALS), '5.711022');
assert.notEqual(
  formatAmount(divUp(inr, rate, USDC_DECIMALS), USDC_DECIMALS),
  formatAmount(divDown(inr, rate, USDC_DECIMALS), USDC_DECIMALS),
  'if these ever match the test asset is too round to prove anything',
);
assert.equal(formatAmount(divUp(new BN('10'), new BN('2'), USDC_DECIMALS), USDC_DECIMALS), '5.000000', 'exact division does not round up');
throws(() => formatAmount(divUp(inr, new BN('0'), USDC_DECIMALS), USDC_DECIMALS), 'division by zero is caught, not formatted as "Infinity"');
ok('divUp/divDown round in the named direction, and never past an exact result');

/* ---- formatAmount refuses to be the place a division silently rounds ---- */

throws(
  () => formatAmount(inr.div(rate), USDC_DECIMALS),
  'a raw .div() has 20+ dp — formatting it would round in whichever direction the default happens to be',
);
ok('formatAmount rejects unrounded arithmetic instead of guessing a direction');

/* ---- the chain edge: base units, at whatever decimals the asset actually has ---- */

assert.equal(toBaseUnits(parseAmount('25', USDC_DECIMALS), USDC_DECIMALS), 25_000_000n);
assert.equal(toBaseUnits(parseAmount('0.07', USDC_DECIMALS), USDC_DECIMALS), 70_000n, '0.07 * 1e6 is 70000.00000000001 as a float');
assert.equal(formatAmount(fromBaseUnits(70_000n, USDC_DECIMALS), USDC_DECIMALS), '0.070000');
// 18dp is where `number` dies: it is exact only below 0.009 units. This is the whole reason the
// helpers take `decimals` instead of assuming 6.
assert.equal(toBaseUnits(parseAmount('1.234567890123456789', 18), 18), 1_234_567_890_123_456_789n);
assert.equal(formatAmount(fromBaseUnits(1_234_567_890_123_456_789n, 18), 18), '1.234567890123456789');
throws(() => toBaseUnits(new BN('0.1234567'), USDC_DECIMALS), 'excess precision must not reach the chain');
ok('toBaseUnits/fromBaseUnits are exact at 6dp and at 18dp');

/* ---- the backend fee seam: same law, applied to the wire `number`s contracts.ts still uses ---- */

assert.equal(roundUp(amt(250).times(1).div(10_000)), 0.025, 'a rail fee is a 6dp USDC amount, not cents');
assert.equal(roundUp(amt(1).times(1).div(10_000)), 0.0001, 'quantized to cents this collected $0 while Circle charged');
assert.equal(roundUp(amt(0.1).plus(0.2)), 0.3, 'the exact sum, not 0.30000000000000004');
assert.equal(roundDown(amt(50).minus(0.5), 2), 49.5, 'what we deliver, floored to the cent we display');
assert.ok(roundUp(amt(1).div(3)) > roundDown(amt(1).div(3)), 'the two directions must actually differ');
ok('roundUp/roundDown carry the rounding law across the wire-number seam');

/* ---- paise survive the trip from a dynamic UPI QR to the screen ---- */

// A ₹249.50 QR seeded the keypad as "249.5" and parseInt read it back as 249, while inrRaw rounded
// the display to ₹250 — so the screen and the quote disagreed, and the user underpaid the invoice.
// The keypad now parses with Number(); inrRaw keeps the paise. Whole amounts are untouched, which is
// what makes this safe for the twelve existing callers.
assert.equal(inrRaw(500), '₹500', 'whole rupees must not grow a ".00"');
assert.equal(inrRaw('500.00'), '₹500', 'a canonical 2dp string is still whole');
assert.equal(inrRaw(249.5), '₹249.50', 'the bug: this used to render ₹250');
assert.equal(inrRaw(1234.5), '₹1,234.50', 'grouping survives the paise');
assert.equal(Number('249.5') || 0, 249.5, 'the keypad parse: parseInt gave 249 here');
assert.equal(Number('249.') || 0, 249, 'tolerates a mid-edit trailing point');
ok('a scanned ₹249.50 keeps its paise through parse and display');

/* ---- the mirrors and the guards that only a script can enforce ---- */

const sharedUnits = readFileSync(join(ROOT, 'packages/shared/src/units.ts'), 'utf8');
const backendUnits = readFileSync(join(ROOT, 'apps/backend/src/lib/units.ts'), 'utf8');
assert.equal(
  backendUnits,
  sharedUnits,
  'backend units.ts has drifted from shared — the client and the trust boundary would disagree on what a valid amount is',
);
ok('backend units.ts still mirrors shared byte-for-byte');

/**
 * The one bug the compiler cannot see. Once a money field is a decimal string, `a.bondUsdc <
 * b.minBondUsdc` still COMPILES — and silently compares lexically, so "900.000000" reads as greater
 * than "2000.000000". Nothing fails; a floor check just stops working.
 *
 * So: read which money fields contracts.ts currently declares as `string`, then refuse any line
 * that compares one with a relational operator without a Number()/parseAmount() in sight.
 */
const contracts = readFileSync(join(ROOT, 'packages/shared/src/contracts.ts'), 'utf8');
const stringMoneyFields = [
  ...new Set(
    [...contracts.matchAll(/^\s{2}(\w*(?:[Uu]sdc?|[Ii]nr|[Rr]upees))\??:\s*string(?:\s*\|\s*null)?;/gm)].map(
      (m) => m[1],
    ),
  ),
];
assert.ok(stringMoneyFields.length > 0, 'found no string money fields — has the regex or contracts.ts drifted?');

// `+` is in here for the same reason as `<`: on two strings it CONCATENATES, and TypeScript is
// perfectly happy with it — `quote.feeInr + quote.networkFeeInr` rendered "40.00" + "8.00" as
// ₹40.008. (`-`, `*`, `/` are safe to omit: those the compiler already rejects on a string.)
//
// The operator must be ADJACENT to the field, on either side — otherwise every JSX line scores a
// hit, because `{usd(m.bondUsdc)}</Txt>` contains a perfectly innocent `>`.
const OPS = '(?:<=?|>=?|\\+)(?!=)';
const compares = (line: string, f: string) =>
  new RegExp(`\\.${f}\\b\\s*${OPS}`).test(line) || new RegExp(`${OPS}\\s*[\\w$.]*\\.${f}\\b`).test(line);

const lexicalRisks: string[] = [];
for (const dir of ['apps/web/src', 'apps/admin/src', 'apps/backend/src']) {
  for (const rel of grepTs(join(ROOT, dir), '')) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      // The scan matches on field NAME, so a local that happens to share one trips it. Such a site
      // opts out with `money:number` — on the line or in the comment block above it, which is where
      // the justification belongs. It's a claim a reader can check, not a mute.
      const optedOut = lines.slice(Math.max(0, i - 4), i + 1).some((l) => l.includes('money:number'));
      if (line.includes('Number(') || line.includes('parseAmount(') || optedOut || line.trimStart().startsWith('//')) {
        return;
      }
      if (stringMoneyFields.some((f) => compares(line, f))) lexicalRisks.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
  }
}
// Printed, not stuffed into the assert message: node truncates a long one, and a truncated list of
// "here is where your money math is wrong" is worse than no list.
if (lexicalRisks.length) {
  console.error('\n✗ these use `<`/`+` on a decimal STRING — lexical compare / concatenation, not arithmetic:');
  lexicalRisks.forEach((r) => console.error('    ' + r));
  console.error('  Fix with Number(), or justify with a `money:number` comment if the value is genuinely numeric.\n');
}
assert.equal(lexicalRisks.length, 0, `${lexicalRisks.length} unsafe money-string operation(s) — listed above`);
ok(`no lexical comparison on any of the ${stringMoneyFields.length} string-typed money fields`);

// pg hands `numeric` back as a string, which is correct and load-bearing: a type parser returning
// a float would silently downgrade every money read in the system, and nothing would fail loudly.
const backendSrc = join(ROOT, 'apps/backend/src');
const hits = grepTs(backendSrc, 'setTypeParser');
assert.equal(hits.length, 0, `setTypeParser found in ${hits.join(', ')} — pg numeric must stay a string`);
ok('nobody has taught pg to parse numeric as a float');

function grepTs(dir: string, needle: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...grepTs(p, needle));
    // .tsx too — the frontends are where a lexical money comparison actually hides.
    else if (/\.tsx?$/.test(p) && readFileSync(p, 'utf8').includes(needle)) out.push(p.slice(ROOT.length + 1));
  }
  return out;
}

console.log(`\ncheck-money: ${passed}/${passed} passed`);
