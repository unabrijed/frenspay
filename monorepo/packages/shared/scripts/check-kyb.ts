// check-kyb.ts — the business-check field spec, and the backend's mirror of it.
// Run: yarn workspace @fpay/shared check:kyb   (joins check:all)
//
// Two things worth defending. First the VALIDATOR, because it decides who is allowed to settle other
// people's money and a hole in it is a business that was never really checked. Second the MIRROR:
// the backend may only `import type` from this package (invariant 5), so lib/kyb.ts carries its own
// runtime copy — and a field present on the form but absent there is silently unvalidated, while one
// present there but absent on the form is permanently unsubmittable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KYB_DECIDABLE, KYB_FIELDS, kybAwaitingMerchant, validateKyb } from '../src/kyb';
import { RAILS } from '../src/rails';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// --- every corridor that can have LPs must be answerable -----------------------------------------
//
// An LP registers on a rail, and their country comes from that rail's corridor. A live rail with no
// field spec means a merchant who can apply, can stake, and can never submit — stuck at 'pending'
// forever with nothing on screen explaining why.
{
  const corridors = readFileSync(join(ROOT, 'apps/backend/src/lib/corridors.ts'), 'utf8');
  for (const r of RAILS.filter((x) => x.live)) {
    if (!corridors.includes(`country: '${r.country}'`)) continue; // rail has no corridor at all
    assert.ok(KYB_FIELDS[r.country], `live rail ${r.id}: no KYB field spec for ${r.country}`);
  }
}

// --- the spec itself is well-formed --------------------------------------------------------------
for (const [country, spec] of Object.entries(KYB_FIELDS)) {
  assert.ok(spec.length > 0, `${country}: empty spec`);
  assert.equal(new Set(spec.map((f) => f.key)).size, spec.length, `${country}: duplicate field keys`);
  for (const f of spec) {
    assert.ok(f.label, `${country}.${f.key}: no label`);
    // A pattern with no anchors matches a substring, so 'XABCDE1234FX' would pass a PAN check.
    if (f.pattern) {
      assert.ok(f.pattern.startsWith('^') && f.pattern.endsWith('$'), `${country}.${f.key}: pattern must be anchored`);
      assert.doesNotThrow(() => new RegExp(f.pattern!), `${country}.${f.key}: pattern does not compile`);
    }
  }
  // The one field every corridor must ask for, whatever else differs. The documented failure mode
  // for this whole business shape is third-party money moving through a personal account; knowing
  // WHICH account before they start is what makes that reviewable rather than discoverable after.
  assert.ok(spec.some((f) => f.key === 'payoutAccount' && !f.optional), `${country}: no required payoutAccount`);
}

// --- validation behaviour ------------------------------------------------------------------------
const IN_OK = {
  legalName: 'Sharma Trading Co',
  entityType: 'Sole proprietor',
  pan: 'ABCDE1234F',
  address: '12 MG Road, Bengaluru 560001',
  contactPhone: '+919876543210',
  payoutAccount: 'sharma@okaxis',
};

assert.deepEqual(validateKyb('IN', IN_OK), [], 'a complete India submission passes');
assert.deepEqual(validateKyb('IN', { ...IN_OK, gstin: '29ABCDE1234F1Z5' }), [], 'a valid optional GSTIN passes');

// An omitted optional field must not be pattern-checked — otherwise "leave blank if not registered"
// is a lie and every unregistered sole proprietor is rejected.
assert.deepEqual(validateKyb('IN', { ...IN_OK, gstin: '' }), [], 'blank optional field is fine');
assert.deepEqual(validateKyb('IN', { ...IN_OK, gstin: '   ' }), [], 'whitespace-only optional is treated as blank');
assert.deepEqual(validateKyb('IN', { ...IN_OK, gstin: 'nonsense' }), ['gstin'], 'a PRESENT optional field is still checked');

// Required fields.
for (const key of ['legalName', 'entityType', 'pan', 'address', 'contactPhone', 'payoutAccount']) {
  const missing = { ...IN_OK, [key]: '' };
  assert.deepEqual(validateKyb('IN', missing), [key], `${key} is required`);
  assert.deepEqual(validateKyb('IN', { ...IN_OK, [key]: '   ' }), [key], `${key} cannot be whitespace`);
}

// Format, including the anchoring bug an unanchored regex would let through.
assert.deepEqual(validateKyb('IN', { ...IN_OK, pan: 'ABCD1234F' }), ['pan'], 'PAN too short');
assert.deepEqual(validateKyb('IN', { ...IN_OK, pan: 'XABCDE1234FX' }), ['pan'], 'PAN must match the WHOLE value');
assert.deepEqual(validateKyb('IN', { ...IN_OK, pan: 'abcde1234f' }), [], 'PAN is case-insensitive');
assert.deepEqual(validateKyb('IN', { ...IN_OK, legalName: 'x'.repeat(121) }), ['legalName'], 'maxLen enforced');

// Several problems at once come back together — a form that reveals one error per round trip is how
// someone gives up on the fourth attempt.
const manyBad = validateKyb('IN', { ...IN_OK, pan: 'nope', legalName: '', payoutAccount: '' });
assert.deepEqual(manyBad.sort(), ['legalName', 'pan', 'payoutAccount'], 'all invalid fields reported at once');

// Indonesia is a different spec, not a translation of India's.
assert.deepEqual(validateKyb('ID', IN_OK).sort(), ['nib'], 'India fields do not satisfy Indonesia');
assert.deepEqual(
  validateKyb('ID', { legalName: 'Warung Sari', entityType: 'Perorangan', nib: '1234567890123', address: 'Jl. Sudirman 1', contactPhone: '+628123456789', payoutAccount: '900012345678' }),
  [],
  'a complete Indonesia submission passes',
);
assert.deepEqual(validateKyb('ID', { nib: '123' }).includes('nib'), true, 'NIB must be 13 digits');

// An unknown country cannot submit at all. Failing closed matters: the alternative is accepting a
// blank submission from a corridor whose identifiers nobody has thought about yet.
assert.deepEqual(validateKyb('ZZ', IN_OK), ['country'], 'unknown country fails closed');
assert.deepEqual(validateKyb('IN', {}).length, 6, 'an empty submission reports every required field');

// --- lifecycle helper ----------------------------------------------------------------------------
assert.equal(kybAwaitingMerchant('pending'), true);
assert.equal(kybAwaitingMerchant('more_info'), true, 'more_info hands the ball back to the merchant');
for (const s of ['submitted', 'under_review', 'approved', 'rejected'] as const) {
  assert.equal(kybAwaitingMerchant(s), false, `${s} is not the merchant's move`);
}

// --- the backend mirror is in step ---------------------------------------------------------------
{
  const backend = readFileSync(join(ROOT, 'apps/backend/src/lib/kyb.ts'), 'utf8');
  for (const [country, spec] of Object.entries(KYB_FIELDS)) {
    for (const f of spec) {
      assert.ok(backend.includes(`key: '${f.key}'`), `backend lib/kyb.ts is missing field '${f.key}' (${country})`);
      if (f.optional) {
        assert.ok(
          new RegExp(`key: '${f.key}',[^\\n]*optional: true`).test(backend),
          `backend lib/kyb.ts: '${f.key}' must be optional there too, or it is unsubmittable`,
        );
      }
      if (f.maxLen) {
        assert.ok(
          new RegExp(`key: '${f.key}',[^\\n]*maxLen: ${f.maxLen}`).test(backend),
          `backend lib/kyb.ts: '${f.key}' maxLen drifted from ${f.maxLen}`,
        );
      }
      if (f.pattern) {
        // The source form of the regex, minus the delimiters the backend writes it with.
        assert.ok(
          backend.includes(f.pattern),
          `backend lib/kyb.ts: '${f.key}' pattern drifted from ${f.pattern}`,
        );
      }
    }
  }
  // A field the BACKEND requires that the form never renders is the mirror image of the same bug.
  const backendKeys = [...backend.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
  const sharedKeys = new Set(Object.values(KYB_FIELDS).flat().map((f) => f.key));
  for (const k of backendKeys) {
    assert.ok(sharedKeys.has(k), `backend lib/kyb.ts validates '${k}', which no form in shared/kyb.ts renders`);
  }
}

// The console decides what buttons to offer from the shared copy; the backend decides what to
// accept from its own. If they drift, a reviewer gets a button that always 409s.
{
  const backend = readFileSync(join(ROOT, 'apps/backend/src/lib/kyb.ts'), 'utf8');
  const line = backend.split('\n').find((l) => l.includes('KYB_DECIDABLE'  + ':')) ?? '';
  for (const s of KYB_DECIDABLE) {
    assert.ok(line.includes(`'${s}'`), `backend KYB_DECIDABLE is missing '${s}' — the console would offer a button the server refuses`);
  }
  // 'pending' must be in NEITHER: nothing has been submitted, so there is nothing to judge.
  assert.ok(!KYB_DECIDABLE.includes('pending'), 'pending is not decidable — nothing has been submitted yet');
  assert.ok(!line.includes("'pending'"), 'backend must not allow deciding a merchant who has submitted nothing');
  for (const terminal of ['approved', 'rejected']) {
    assert.ok(!KYB_DECIDABLE.includes(terminal), `${terminal} is terminal — reopening it is a separate action`);
  }

  const subLine = backend.split('\n').find((l) => l.includes('KYB_SUBMITTABLE' + ':')) ?? '';
  for (const s of ['pending', 'more_info']) {
    assert.ok(subLine.includes(`'${s}'`), `backend KYB_SUBMITTABLE must accept '${s}'`);
  }
  // The two sets overlap on exactly 'more_info' — the state where the ball is with the merchant but
  // a reviewer can still change their mind. Any other overlap means both sides can act at once.
  const subStates = ['pending', 'submitted', 'under_review', 'more_info', 'approved', 'rejected'].filter((s) =>
    subLine.includes(`'${s}'`),
  );
  const overlap = subStates.filter((s) => KYB_DECIDABLE.includes(s));
  assert.deepEqual(overlap, ['more_info'], 'submittable and decidable may overlap only on more_info');
}

console.log('check-kyb: all assertions passed');
