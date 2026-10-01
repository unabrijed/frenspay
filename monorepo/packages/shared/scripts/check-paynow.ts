import assert from 'node:assert/strict';
import { emvCrc16, parsePayNowQr } from '../src/paynow';
import { classifyPayTarget } from '../src/payTarget';
import { parseEmvQr } from '../src/emvqr';
import { railById } from '../src/rails';
import { fiatDecimals, normalizeAmount } from '../src/units';

const t = (tag: string, value: string) => tag + String(Array.from(value).length).padStart(2, '0') + value;
const seal = (value: string) => value + '6304' + emvCrc16(value + '6304');
const template = (type = '2', value = '201411660R', editable = '1', tail = '') =>
  t('00', 'SG.PAYNOW') + t('01', type) + t('02', value) + t('03', editable) + tail;
const qr = (sub = template(), root = '', prefix = '', currency = '702', country = 'SG') =>
  seal(t('00', '01') + t('01', '11') + prefix + t('26', sub) + t('53', currency) + t('58', country) + t('59', 'Sandbox Shop') + root);
const rejected = (value: string, label: string) => {
  assert.equal(classifyPayTarget(value).kind, 'unsupported', label);
  assert.equal(parseEmvQr(value), null, `${label}: generic parser cannot fall through`);
};

assert.equal(emvCrc16('123456789'), '29B1', 'independent CCITT-FALSE known vector');
assert.equal(railById('paynow').live, false);
assert.equal(railById('paynow').country, 'SG');
assert.equal(fiatDecimals('SGD'), 2);
assert.equal(normalizeAmount('12.5', 2), '12.50');
assert.throws(() => normalizeAmount('12.501', 2));
const business = classifyPayTarget(qr(template('2', '201411660R', '0', t('05', 'INV-123')), t('54', '12.50')));
assert.deepEqual(business, { kind: 'paynow', proxyType: 'uen', proxyValue: '201411660R', name: 'Sandbox Shop',
  amountSgd: 12.5, amountEditable: false, reference: 'INV-123', expiresAt: undefined });
const phone = classifyPayTarget(qr(template('0', '+6588889999')));
assert.equal(phone.kind, 'paynow');
if (phone.kind === 'paynow') assert.equal(phone.proxyType, 'mobile_number');
assert.equal(classifyPayTarget('+6588889999').kind, 'phone', 'bare phone remains directory lookup');
assert.equal(classifyPayTarget('tel:+6588889999').kind, 'phone');
assert.equal(classifyPayTarget('shop@okaxis').kind, 'upi');
assert.equal(classifyPayTarget(qr(template('2', '201411660R001'))).kind, 'paynow', 'UEN suffix preserved');
const multis = qr(template(), '', t('27', t('00', 'SG.OTHER') + t('01', 'OTHER')));
assert.equal(classifyPayTarget(multis).kind, 'paynow', 'multi-scheme QR finds the PayNow template');
assert.equal(parseEmvQr(multis)?.rail, 'paynow');
assert.equal(classifyPayTarget(qr(template(), t('62', t('05', 'BILL123')))).kind, 'paynow');
const ref = parsePayNowQr(qr(template(), t('62', t('05', 'BILL123'))));
if (ref?.kind === 'paynow') assert.equal(ref.reference, 'BILL123');

rejected(qr().slice(0, -4) + '0000', 'bad CRC');
rejected(qr().slice(0, -2), 'truncated');
rejected(qr(template(), t('53', '702')), 'duplicate tag');
rejected(qr(template(), '', t('27', template('0', '+6588889999'))), 'conflicting PayNow templates');
rejected(qr(template(), t('54', '1.234')), 'fractional cents');
rejected(qr(template(), t('54', '0')), 'zero amount');
rejected(qr(template(), t('54', '-1')), 'negative amount');
rejected(qr(template(), t('54', '1e2')), 'exponential amount');
rejected(qr(template('2', '201411660R', '0')), 'fixed amount missing');
rejected(qr(template('2', '201411660R', '9')), 'bad editability');
rejected(qr(template('1', 'S1234567A')), 'NRIC unsupported');
rejected(qr(template('3', '+6588889999#GRAB')), 'VPA unsupported');
rejected(qr(template('0', '+918888999999')), 'non-Singapore phone');
rejected(qr(template('0', '+6568889999')), 'not a mobile number');
rejected(qr(template('2', 'bad@uen')), 'bad UEN');
rejected(qr(template('2', '201411660R', '1', t('01', '0'))), 'duplicate subtag');
rejected(qr(template('2', '201411660R', '1', t('99', 'new'))), 'unknown PayNow instructions');
rejected(qr(template(), '', '', '356'), 'foreign currency');
rejected(qr(template(), '', '', '999'), 'unknown currency');
rejected(qr(template(), '', '', '702', 'IN'), 'wrong country');
rejected(qr(template(), t('55', '01')), 'fee instructions');
rejected(qr(template('2', '201411660R', '1', t('05', 'ONE')), t('62', t('05', 'TWO'))), 'reference conflict');
rejected(qr(template(), t('62', '0509short')), 'malformed additional data');
rejected(qr('0009SG.PAYNOW01012'), 'malformed template');
rejected(qr(t('00', 'SG.SGQR') + t('01', 'registry')), 'SGQR without PayNow');
// An invalid SG payload must not route into an otherwise live sibling template.
rejected(qr(template(), '', t('27', t('00', 'A000000524') + t('01', 'shop@okaxis')), '356'), 'no live sibling fallback');

const now = Date.parse('2026-09-28T12:00:00Z');
const expiring = qr(template('2', '201411660R', '1', t('04', '20260928')));
const dateOnly = parsePayNowQr(expiring, now);
assert.equal(dateOnly?.kind, 'paynow');
if (dateOnly?.kind === 'paynow') assert.equal(dateOnly.expiresAt, '2026-09-28T15:59:59.999Z');
assert.equal(parsePayNowQr(expiring, Date.parse('2026-09-28T16:00:00Z'))?.kind, 'unsupported');
assert.equal(parsePayNowQr(qr(template('2', '201411660R', '1', t('04', '20260928203000'))), now)?.kind, 'paynow');
assert.equal(parsePayNowQr(qr(template('2', '201411660R', '1', t('04', '20260928203000'))), now + 1_800_000)?.kind, 'unsupported');
for (const invalidDate of ['20260230', '20261301', '20260928246000', 'notadate']) {
  assert.equal(parsePayNowQr(qr(template('2', '201411660R', '1', t('04', invalidDate))), now)?.kind, 'unsupported');
}
assert.equal(parsePayNowQr('upi://pay?pa=shop@okaxis'), null);
console.log('check-paynow: QR validation, SGD precision, inactive rail and legacy classification passed');
