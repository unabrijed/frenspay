// check-rails.ts — self-check for the scan-and-pay rail registry + EMV QR parser.
// Run: yarn workspace @fpay/shared check:rails
// Same pattern as the backend's check-waitlist.ts: plain asserts over the pure logic, no framework.
import assert from 'node:assert/strict';

import { parseEmvQr } from '../src/emvqr';
import { RAILS, railById, vpaOperator } from '../src/rails';

// Build TLV programmatically so the length prefixes can't be hand-miscounted.
const t = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, '0')}${value}`;

// --- registry invariants ---
assert.equal(RAILS.filter((r) => r.live).map((r) => r.id).join(','), 'upi', 'only UPI is live today');
assert.equal(new Set(RAILS.map((r) => r.id)).size, RAILS.length, 'rail ids unique');
assert.equal(railById('promptpay').currency, 'THB');

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
