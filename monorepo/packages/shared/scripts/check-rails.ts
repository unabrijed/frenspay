// check-rails.ts — self-check for the scan-and-pay rail registry + EMV QR parser.
// Run: yarn workspace @fpay/shared check:rails
// Same pattern as the backend's check-waitlist.ts: plain asserts over the pure logic, no framework.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAYOUT_METHODS } from '../src/contracts';
import { parseEmvQr } from '../src/emvqr';
import { classifyPayTarget } from '../src/payTarget';
import { countryFromTimeZone, currencyForCountry } from '../src/currencyCodes';
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

// currencyCodes.ts is a SECOND country table (display-only, see its header). It answers a
// different question to this registry, but wherever both have an opinion they must agree — a rail
// in country X paying in currency Y, while someone standing in X reads their balance in Z, is a
// contradiction users would see. Only asserted for rails: the display table covers ~250 countries
// this registry says nothing about, which is the point of it existing.
for (const r of RAILS) {
  assert.equal(currencyForCountry(r.country), r.currency, `${r.id}: rail currency vs display table for ${r.country}`);
}

// Where the device stands → which country → which currency. The alias pair is the whole reason
// this is asserted: the tz database calls one zone both Asia/Kolkata and Asia/Calcutta, engines
// hand back different halves of that pair, and a lookup that misses would put a user in India
// nowhere at all — straight back to reading a country out of navigator.language.
assert.equal(countryFromTimeZone('Asia/Kolkata'), 'IN', 'modern spelling resolves');
assert.equal(countryFromTimeZone('Asia/Calcutta'), 'IN', 'legacy alias resolves the same');
assert.equal(currencyForCountry(countryFromTimeZone('Asia/Jakarta')), 'IDR');
assert.equal(currencyForCountry(countryFromTimeZone('Europe/London')), 'GBP');
assert.equal(countryFromTimeZone('Not/AZone'), '', 'garbage zone → unknown, never a wrong country');

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
  // Constraints evolve through ADDITIVE migrations. Assert their latest definitions, never require
  // rewriting historical migrations just to introduce another vocabulary value.
  const directory = join(ROOT, 'apps/backend/src/db/migrations');
  const constraints = new Map<string, string>();
  for (const file of readdirSync(directory).filter((f) => /^\d+.*\.sql$/.test(f)).sort()) {
    const sql = readFileSync(join(directory, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const match of sql.matchAll(/(?:add\s+)?constraint\s+(\w+)\s+check\s*\(([^;]+?)\)(?=\s*[,;\n])/gi)) {
      constraints.set(match[1], match[2]);
    }
  }
  for (const m of PAYOUT_METHODS) {
    for (const name of ['merchants_rail_chk', 'quotes_payout_chk', 'payout_providers_method_chk']) {
      assert.ok(constraints.get(name)?.includes(`'${m}'`), `${name}: latest CHECK is missing payout method '${m}'`);
    }
  }

  // Every LIVE rail must be priceable on the backend too: its currency literal must appear in the
  // corridor registry (a rail flipped live without a corridor fails here, not inside a quote).
  // Same for its COUNTRY, which the corridor mirrors from this registry so routing can hard-filter
  // the LP pool by it — a corridor carrying the wrong country would offer an order to a pool that
  // cannot serve it.
  for (const r of RAILS.filter((x) => x.live)) {
    assert.ok(corridors.includes(`'${r.currency}'`), `live rail ${r.id}: backend corridors.ts has no '${r.currency}' corridor`);
    assert.ok(corridors.includes(`country: '${r.country}'`), `live rail ${r.id}: backend corridors.ts has no country: '${r.country}'`);
  }

  // Parse the registry entries whole (single-line and multi-line bodies both) rather than pinning
  // field order — the previous regex hard-coded `currency` immediately followed by `model`, so a
  // field inserted between them silently matched nothing and every assert below passed vacuously.
  const entries = [...corridors.matchAll(/^ {2}(\w+): \{([\s\S]*?)\},$/gm)].map(([, key, body]) => ({ key, body }));
  assert.ok(entries.length >= 2, 'corridor registry parsed empty — the entry regex drifted');

  // Every payout method is either a corridor KEY or explicitly declared not-quotable. This replaced
  // a `corridors.includes("'bank'")` text match over the WHOLE FILE, comments included — which
  // 'Pix' had been passing for months purely because a comment mentioned it, and which 'bank' would
  // have kept passing after its corridor was removed. A method vanishing from the registry has to
  // be a decision someone wrote down, not a string that happens to appear somewhere.
  const keys = new Set(entries.map((e) => e.key));
  const notQuotable = new Set(
    [...corridors.matchAll(/^export const NOT_QUOTABLE[^=]*=\s*\[([^\]]*)\]/gm)]
      .flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1])),
  );
  assert.ok(notQuotable.size > 0, 'could not parse NOT_QUOTABLE out of corridors.ts');
  for (const m of PAYOUT_METHODS) {
    assert.ok(
      keys.has(m) || notQuotable.has(m),
      `payout method '${m}' has no corridor and is not declared in NOT_QUOTABLE — decide which`,
    );
    assert.ok(!(keys.has(m) && notQuotable.has(m)), `payout method '${m}' is both a corridor and not-quotable`);
  }
  for (const m of notQuotable) {
    assert.ok(
      (PAYOUT_METHODS as readonly string[]).includes(m),
      `NOT_QUOTABLE names '${m}', which is not a payout method`,
    );
  }

  // A corridor whose ONLY settler is a provider needs its platform settlement row in the seed
  // (docs/23) — with no 'psp' merchant on that rail and no LP pool underneath it, it quotes
  // no_merchant forever. A corridor that also lists 'lp' is covered by the pool, so listing
  // 'provider' there is a preference that is simply unsatisfiable until one is configured
  // (UPI today: prefers a provider, has none, settles through the LP network).
  const seed = readFileSync(join(ROOT, 'apps/backend/src/db/seed.ts'), 'utf8');
  const providerKeys = entries.filter((e) => e.body.includes("'provider'")).map((e) => e.key);
  for (const e of entries) {
    if (e.body.includes("'provider'") && !e.body.includes("'lp'")) {
      assert.ok(seed.includes(`'${e.key}'`) && seed.includes(`'psp'`), `provider-only corridor ${e.key}: seed.ts has no platform 'psp' merchant row for it`);
    }
  }
  assert.ok(providerKeys.includes('QRIS'), 'QRIS settles provider-first (docs/23) — registry drifted if this fails');
  // Indonesia settles through the platform row TODAY (there is no QRIS LP network yet), so losing
  // that seed row would break the live corridor even though the fallback makes it structurally legal.
  assert.ok(seed.includes(`'QRIS'`) && seed.includes(`'psp'`), "seed.ts has no platform 'psp' merchant row for QRIS");

  // `settle` is an ordered preference and the order is the product decision: automated settlement
  // beats waking a human, so 'provider' must never be listed after 'lp'.
  for (const e of entries) {
    const p = e.body.indexOf("'provider'");
    const l = e.body.indexOf("'lp'");
    assert.ok(p !== -1 || l !== -1, `corridor ${e.key}: no settle preference at all`);
    if (p !== -1 && l !== -1) assert.ok(p < l, `corridor ${e.key}: 'lp' is preferred over 'provider'`);
  }
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
