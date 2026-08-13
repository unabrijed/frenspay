// currencyCodes.ts — ISO 3166-1 alpha-2 → ISO 4217 currency. Pure data, zero deps (shared-package
// invariant). Sibling to dialCodes.ts and carrying the same country set and the same risk profile:
// this is a DISPLAY table, so a wrong entry names a currency we then hold no rate for, and the
// balance falls back to dollars. It can never mis-pay.
//
// Deliberately NOT the rails registry. Which countries fpay can PAY IN is rails.ts and nothing
// else (docs/21); which currency someone's money reads in where they live is this, and the two
// answer different questions. Gating the display on rails meant a user in Japan saw no yen for
// want of a Japanese payment rail, when the real reason should be that nothing prices JPY yet.
// check-rails.ts asserts the two tables agree wherever they overlap.
//
// Antarctica (AQ) is in dialCodes and absent here on purpose — it has no currency of its own.
export const ISO_TO_CURRENCY: Record<string, string> = {
  AD: 'EUR', AE: 'AED', AF: 'AFN', AG: 'XCD', AI: 'XCD', AL: 'ALL', AM: 'AMD', AO: 'AOA', AR: 'ARS', AS: 'USD',
  AT: 'EUR', AU: 'AUD', AW: 'AWG', AX: 'EUR', AZ: 'AZN', BA: 'BAM', BB: 'BBD', BD: 'BDT', BE: 'EUR', BF: 'XOF',
  BG: 'BGN', BH: 'BHD', BI: 'BIF', BJ: 'XOF', BL: 'EUR', BM: 'BMD', BN: 'BND', BO: 'BOB', BQ: 'USD', BR: 'BRL',
  BS: 'BSD', BT: 'BTN', BW: 'BWP', BY: 'BYN', BZ: 'BZD', CA: 'CAD', CC: 'AUD', CD: 'CDF', CF: 'XAF', CG: 'XAF',
  CH: 'CHF', CI: 'XOF', CK: 'NZD', CL: 'CLP', CM: 'XAF', CN: 'CNY', CO: 'COP', CR: 'CRC', CU: 'CUP', CV: 'CVE',
  CW: 'ANG', CX: 'AUD', CY: 'EUR', CZ: 'CZK', DE: 'EUR', DJ: 'DJF', DK: 'DKK', DM: 'XCD', DO: 'DOP', DZ: 'DZD',
  EC: 'USD', EE: 'EUR', EG: 'EGP', EH: 'MAD', ER: 'ERN', ES: 'EUR', ET: 'ETB', FI: 'EUR', FJ: 'FJD', FK: 'FKP',
  FM: 'USD', FO: 'DKK', FR: 'EUR', GA: 'XAF', GB: 'GBP', GD: 'XCD', GE: 'GEL', GF: 'EUR', GG: 'GBP', GH: 'GHS',
  GI: 'GIP', GL: 'DKK', GM: 'GMD', GN: 'GNF', GP: 'EUR', GQ: 'XAF', GR: 'EUR', GS: 'GBP', GT: 'GTQ', GU: 'USD',
  GW: 'XOF', GY: 'GYD', HK: 'HKD', HN: 'HNL', HR: 'EUR', HT: 'HTG', HU: 'HUF', ID: 'IDR', IE: 'EUR', IL: 'ILS',
  IM: 'GBP', IN: 'INR', IO: 'USD', IQ: 'IQD', IR: 'IRR', IS: 'ISK', IT: 'EUR', JE: 'GBP', JM: 'JMD', JO: 'JOD',
  JP: 'JPY', KE: 'KES', KG: 'KGS', KH: 'KHR', KI: 'AUD', KM: 'KMF', KN: 'XCD', KP: 'KPW', KR: 'KRW', KW: 'KWD',
  KY: 'KYD', KZ: 'KZT', LA: 'LAK', LB: 'LBP', LC: 'XCD', LI: 'CHF', LK: 'LKR', LR: 'LRD', LS: 'LSL', LT: 'EUR',
  LU: 'EUR', LV: 'EUR', LY: 'LYD', MA: 'MAD', MC: 'EUR', MD: 'MDL', ME: 'EUR', MF: 'EUR', MG: 'MGA', MH: 'USD',
  MK: 'MKD', ML: 'XOF', MM: 'MMK', MN: 'MNT', MO: 'MOP', MP: 'USD', MQ: 'EUR', MR: 'MRU', MS: 'XCD', MT: 'EUR',
  MU: 'MUR', MV: 'MVR', MW: 'MWK', MX: 'MXN', MY: 'MYR', MZ: 'MZN', NA: 'NAD', NC: 'XPF', NE: 'XOF', NF: 'AUD',
  NG: 'NGN', NI: 'NIO', NL: 'EUR', NO: 'NOK', NP: 'NPR', NR: 'AUD', NU: 'NZD', NZ: 'NZD', OM: 'OMR', PA: 'PAB',
  PE: 'PEN', PF: 'XPF', PG: 'PGK', PH: 'PHP', PK: 'PKR', PL: 'PLN', PM: 'EUR', PR: 'USD', PS: 'ILS', PT: 'EUR',
  PW: 'USD', PY: 'PYG', QA: 'QAR', RE: 'EUR', RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR', SB: 'SBD',
  SC: 'SCR', SD: 'SDG', SE: 'SEK', SG: 'SGD', SH: 'SHP', SI: 'EUR', SJ: 'NOK', SK: 'EUR', SL: 'SLE', SM: 'EUR',
  SN: 'XOF', SO: 'SOS', SR: 'SRD', SS: 'SSP', ST: 'STN', SV: 'USD', SX: 'ANG', SY: 'SYP', SZ: 'SZL', TC: 'USD',
  TD: 'XAF', TG: 'XOF', TH: 'THB', TJ: 'TJS', TK: 'NZD', TL: 'USD', TM: 'TMT', TN: 'TND', TO: 'TOP', TR: 'TRY',
  TT: 'TTD', TV: 'AUD', TW: 'TWD', TZ: 'TZS', UA: 'UAH', UG: 'UGX', US: 'USD', UY: 'UYU', UZ: 'UZS', VA: 'EUR',
  VC: 'XCD', VE: 'VES', VG: 'USD', VI: 'USD', VN: 'VND', VU: 'VUV', WF: 'XPF', WS: 'WST', XK: 'EUR', YE: 'YER',
  YT: 'EUR', ZA: 'ZAR', ZM: 'ZMW', ZW: 'ZWG',
};

/** What someone in this country spends, or '' when we don't know the country (it stays empty until
 *  /me lands) or have no entry. '' is meaningful to callers: it means "no local currency", which is
 *  how the balance decides to fall back to dollars. */
export const currencyForCountry = (iso: string): string => ISO_TO_CURRENCY[iso] ?? '';

// --- where the device is ---------------------------------------------------------------------
// The IANA timezone, not navigator.language. A language tag is a FORMATTING preference: Chrome on
// macOS hands out en-GB to people who have never been to Britain, and reading a country out of it
// put an Indian user in the United Kingdom. The timezone is the only free signal that answers
// "where is this device standing", which is the question the country is actually asked.

/** Canonical spelling of a timezone id. The tz database carries aliases (Asia/Kolkata is the same
 *  zone as Asia/Calcutta) and engines disagree on which one they hand back — `getTimeZones()`
 *  returned Calcutta where `resolvedOptions()` returns Kolkata. Both sides of the lookup go through
 *  this so they agree on whichever spelling the running engine prefers. */
const canonicalZone = (tz: string): string => {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return tz;
  }
};

/** Built once, from Intl's own country → timezones data, so there is no second table to keep. */
let ZONE_TO_ISO: Record<string, string> | null = null;
const zoneIndex = (): Record<string, string> => {
  if (ZONE_TO_ISO) return ZONE_TO_ISO;
  const index: Record<string, string> = {};
  for (const iso of Object.keys(ISO_TO_CURRENCY)) {
    // Not in lib ES2022 (Intl Locale Info is newer than the target), and absent entirely on older
    // engines — hence the cast and the `?.`. No method → empty index → callers fall back.
    const zones = (new Intl.Locale(`und-${iso}`) as unknown as { getTimeZones?: () => string[] }).getTimeZones?.();
    for (const tz of zones ?? []) index[canonicalZone(tz)] = iso;
  }
  ZONE_TO_ISO = index;
  return index;
};

/** ISO 3166-1 alpha-2 for a timezone (the device's own by default), or '' when we can't tell.
 *  '' is the same "we don't know" every other country source uses — never a guessed country. */
export function countryFromTimeZone(tz?: string): string {
  try {
    return zoneIndex()[canonicalZone(tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone)] ?? '';
  } catch {
    return '';
  }
}
