// check-rails.ts — self-check for the scan-and-pay rail registry + EMV QR parser.
// Run: yarn workspace @fpay/shared check:rails
// Same pattern as the backend's check-waitlist.ts: plain asserts over the pure logic, no framework.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAYOUT_METHODS } from '../src/contracts';
import { parseEmvQr } from '../src/emvqr';
import { classifyPayTarget } from '../src/payTarget';
import { RAILS, railById, vpaOperator } from '../src/rails';
import { FIAT_DECIMALS } from '../src/units';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// Build TLV programmatically so the length prefixes can't be hand-miscounted.
const t = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, '0')}${value}`;

// --- registry invariants ---
assert.equal(RAILS.filter((r) => r.live).map((r) => r.id).join(','), 'upi,qris', 'live rails: UPI (India) + QRIS (Indonesia)');
assert.equal(new Set(RAILS.map((r) => r.id)).size, RAILS.length, 'rail ids unique');
assert.equal(railById('promptpay').currency, 'THB');
assert.equal(railById('qris').currency, 'IDR');

// Every LIVE rail's currency must be priceable: fiat decimals here, and an FX band + fallback on
// the backend (asserted by check-fx). A rail flipped live without them throws inside a quote.
for (const r of RAILS.filter((x) => x.live)) {
  assert.ok(FIAT_DECIMALS[r.currency] != null, `live rail ${r.id}: no FIAT_DECIMALS for ${r.currency}`);
}

// The backend's corridor registry is a MIRROR (it can only `import type` from this package) — the
// same keep-them-honest pattern as check-paytarget's VPA_RE assert. Every payout method must
// appear verbatim in apps/backend/src/lib/corridors.ts, and the DB CHECKs (0004 quotes/merchants,
// 0005 payout_providers) must allow it.
{
  const corridors = readFileSync(join(ROOT, 'apps/backend/src/lib/corridors.ts'), 'utf8');
  const migration4 = readFileSync(join(ROOT, 'apps/backend/src/db/migrations/0004_corridor_currency.sql'), 'utf8');
  const migration5 = readFileSync(join(ROOT, 'apps/backend/src/db/migrations/0005_payout_providers.sql'), 'utf8');
  for (const m of PAYOUT_METHODS) {
    assert.ok(corridors.includes(`'${m}'`), `backend lib/corridors.ts is missing payout method '${m}'`);
    assert.ok(migration4.includes(`'${m}'`), `migration 0004 CHECK is missing payout method '${m}'`);
    assert.ok(migration5.includes(`'${m}'`), `migration 0005 payout_providers CHECK is missing payout method '${m}'`);
  }

  // Every LIVE rail must be priceable on the backend too: its currency literal must appear in the
  // corridor registry (a rail flipped live without a corridor fails here, not inside a quote).
  for (const r of RAILS.filter((x) => x.live)) {
    assert.ok(corridors.includes(`'${r.currency}'`), `live rail ${r.id}: backend corridors.ts has no '${r.currency}' corridor`);
  }

  // Every provider-model corridor needs its platform settlement row in the seed (docs/23):
  // a `model: 'provider'` entry with no 'psp' merchant on that rail quotes no_merchant forever.
  const seed = readFileSync(join(ROOT, 'apps/backend/src/db/seed.ts'), 'utf8');
  const providerKeys = [...corridors.matchAll(/^  (\w+): \{\n    currency: '\w+',\n    model: 'provider'/gm)].map((m) => m[1]);
  for (const k of providerKeys) {
    assert.ok(seed.includes(`'${k}'`) && seed.includes(`'psp'`), `provider corridor ${k}: seed.ts has no platform 'psp' merchant row for it`);
  }
  assert.ok(providerKeys.includes('QRIS'), 'QRIS is the provider-model corridor (docs/23) — registry regex drifted if this fails');
}

// --- UPI operator resolution ---
assert.equal(vpaOperator('asha@okaxis')?.name, 'Google Pay');
assert.equal(vpaOperator('9876543210@ybl')?.name, 'PhonePe');
assert.equal(vpaOperator('shop@PayTM')?.name, 'Paytm', 'suffix lookup is case-insensitive');
assert.equal(vpaOperator('x@hdfcbank')?.type, 'bank');
assert.equal(vpaOperator('x@upi')?.type, 'network');
assert.equal(vpaOperator('x@somefutureipsp'), undefined, 'unknown suffix identifies nothing, blocks nothing');
assert.equal(vpaOperator('no-at-sign'), undefined);

// --- PromptPay (Thailand): AID template, phone proxy, THB amount ---
const promptpay =
  t('00', '01') +
  t('01', '12') +
  t('29', t('00', 'A000000677010111') + t('01', '0066812345678')) +
  t('53', '764') +
  t('54', '100.00') +
  t('58', 'TH') +
  t('59', 'Jane Cafe') +
  t('63', 'ABCD');
const pp = parseEmvQr(promptpay);
assert.deepEqual(
  { rail: pp?.rail, kind: pp?.kind, address: pp?.address, amount: pp?.amount, currency: pp?.currency, name: pp?.name },
  { rail: 'promptpay', kind: 'phone', address: '+66812345678', amount: 100, currency: 'THB', name: 'Jane Cafe' },
);

// National-id proxy variant.
const ppId = parseEmvQr(t('00', '01') + t('29', t('00', 'A000000677010111') + t('02', '1234567890123')));
assert.equal(ppId?.kind, 'national-id');

// --- Pix (Brazil): GUI template, key kinds ---
const pix = parseEmvQr(
  t('00', '01') + t('26', t('00', 'br.gov.bcb.pix') + t('01', 'fulano@example.com')) + t('53', '986') + t('59', 'Joao'),
);
assert.deepEqual({ rail: pix?.rail, kind: pix?.kind, currency: pix?.currency }, { rail: 'pix', kind: 'email', currency: 'BRL' });
assert.equal(parseEmvQr(t('00', '01') + t('26', t('00', 'BR.GOV.BCB.PIX') + t('01', '12345678901')))?.kind, 'national-id', 'CPF key, GUI case-insensitive');
assert.equal(
  parseEmvQr(t('00', '01') + t('26', t('00', 'br.gov.bcb.pix') + t('01', '123e4567-e89b-12d3-a456-426614174000')))?.kind,
  'random-key',
);

// --- DuitNow (Malaysia) ---
const dn = parseEmvQr(t('00', '01') + t('26', t('00', 'A000000615') + t('01', '60123456789')) + t('53', '458'));
assert.deepEqual({ rail: dn?.rail, currency: dn?.currency }, { rail: 'duitnow', currency: 'MYR' });

// --- QRIS (Indonesia): national template in tag 51, NMID proxy, IDR currency mapped ---
const qris = parseEmvQr(
  t('00', '01') +
    t('26', t('00', 'ID.CO.SHOPEE.WWW') + t('01', '936000091234567890')) + // acquirer template names no rail we know
    t('51', t('00', 'ID.CO.QRIS.WWW') + t('01', 'ID1021125405972') + t('03', 'UMI')) +
    t('53', '360') +
    t('54', '50000') +
    t('58', 'ID') +
    t('59', 'Warung Sari'),
);
assert.deepEqual(
  { rail: qris?.rail, kind: qris?.kind, address: qris?.address, amount: qris?.amount, currency: qris?.currency, name: qris?.name },
  { rail: 'qris', kind: 'merchant', address: 'ID1021125405972', amount: 50000, currency: 'IDR', name: 'Warung Sari' },
);
// The classifier joins the live pay path with the NMID + the IDR amount.
const qrisTarget = classifyPayTarget(
  t('00', '01') + t('51', t('00', 'ID.CO.QRIS.WWW') + t('01', 'ID1021125405972')) + t('53', '360') + t('54', '50000'),
);
assert.deepEqual(
  { kind: qrisTarget.kind, payee: (qrisTarget as { payee?: string }).payee, amountIdr: (qrisTarget as { amountIdr?: number }).amountIdr },
  { kind: 'qris', payee: 'ID1021125405972', amountIdr: 50000 },
);
// A QRIS QR declaring a FOREIGN currency keeps the destination but refuses the amount prefill.
const qrisForeign = classifyPayTarget(
  t('00', '01') + t('51', t('00', 'ID.CO.QRIS.WWW') + t('01', 'ID1021125405972')) + t('53', '356') + t('54', '50000'),
);
assert.deepEqual(
  { kind: qrisForeign.kind, amountIdr: (qrisForeign as { amountIdr?: number }).amountIdr },
  { kind: 'qris', amountIdr: undefined },
  'an INR-declared amount never seeds the Rp keypad',
);
// A declared-currency MISMATCH on the live UPI path refuses the prefill (rail is the authority).
const mismatch = classifyPayTarget(t('00', '01') + t('26', t('00', 'A000000524') + t('01', 'shop@okhdfcbank')) + t('53', '360') + t('54', '50000'));
assert.deepEqual({ kind: mismatch.kind, amountInr: (mismatch as { amountInr?: number }).amountInr }, { kind: 'upi', amountInr: undefined }, 'IDR amount never seeds the ₹ keypad');

// --- Bharat-QR UPI: identified AND carries the VPA + operator into the live path ---
const bharat = parseEmvQr(t('00', '01') + t('26', t('00', 'A000000524') + t('01', 'shop@okhdfcbank')) + t('53', '356') + t('54', '250'));
assert.deepEqual(
  { rail: bharat?.rail, kind: bharat?.kind, address: bharat?.address, operator: bharat?.operator?.name, amount: bharat?.amount },
  { rail: 'upi', kind: 'vpa', address: 'shop@okhdfcbank', operator: 'Google Pay', amount: 250 },
);

// --- rejects: non-EMV, truncated TLV, EMV with no known rail ---
assert.equal(parseEmvQr('upi://pay?pa=x@y'), null);
assert.equal(parseEmvQr('hello world'), null);
assert.equal(parseEmvQr('0002019904'), null, 'length overruns payload');
assert.equal(parseEmvQr(t('00', '01') + t('26', t('00', 'com.example.unknown') + t('01', 'x'))), null);
assert.equal(parseEmvQr(''), null);

console.log('check-rails: all assertions passed');
