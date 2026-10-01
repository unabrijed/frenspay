// rails.ts — the scan-and-pay rails registry. Product law: the countries fpay supports paying IN
// are exactly the countries with a scan-and-pay rail in this list — nothing else defines
// supported countries anywhere. `live` = payout actually works end-to-end today (quotes + LP
// routing); a non-live rail still scans and identifies cleanly, the pay flow just says "not yet".
// Going live for a new rail is the multi-currency milestone (per-currency quotes/FX/LP rails),
// not a flag flip here.

export type RailId = 'upi' | 'qris' | 'promptpay' | 'pix' | 'duitnow' | 'paynow';

export interface Rail {
  id: RailId;
  name: string;
  country: string; // ISO 3166-1 alpha-2
  currency: string; // ISO 4217
  live: boolean;
}

export const RAILS: Rail[] = [
  { id: 'upi', name: 'UPI', country: 'IN', currency: 'INR', live: true },
  { id: 'qris', name: 'QRIS', country: 'ID', currency: 'IDR', live: true }, // Indonesia corridor (sim LPs; PSP sandbox behind it)
  { id: 'promptpay', name: 'PromptPay', country: 'TH', currency: 'THB', live: false },
  { id: 'pix', name: 'Pix', country: 'BR', currency: 'BRL', live: false },
  { id: 'duitnow', name: 'DuitNow', country: 'MY', currency: 'MYR', live: false },
  { id: 'paynow', name: 'PayNow', country: 'SG', currency: 'SGD', live: false }, // recognition + isolated StraitsX sandbox only
];

export const railById = (id: RailId): Rail => RAILS.find((r) => r.id === id)!;

// `currencyForCountry` deliberately does NOT live here. Which currency someone's balance reads in
// is a display question about where they are, not about where fpay can pay — see currencyCodes.ts.

/** Who actually processes a payment address — the PSP app, the bank, or the network itself. */
export interface Operator {
  code: string; // the alias suffix / registry key
  name: string; // human name shown as "via <name>"
  type: 'psp' | 'bank' | 'network';
}

/** How a scanned payment address is identified: which rail, what kind of alias, and (when the
 *  alias encodes it) which operator processes it. This is identification for display/UX only —
 *  the backend's own validation stays the authority on what is payable. */
export interface RailTarget {
  rail: RailId;
  kind: 'vpa' | 'phone' | 'national-id' | 'e-wallet' | 'email' | 'random-key' | 'merchant';
  address: string;
  operator?: Operator;
  name?: string; // payee name embedded in the QR
  amount?: number; // in the rail's currency
  currency?: string; // ISO 4217, when the QR declares one
}

// Known UPI handle suffixes → operator. India's VPA is local@suffix where the suffix names the
// PSP app (which may route via several partner banks, e.g. PhonePe = @ybl/@ibl/@axl) or the bank
// directly. NPCI mints new handles constantly, so this is a courtesy directory, NOT a validator:
// unknown suffix → undefined → the UI just says "UPI". Extend freely; a wrong entry mislabels a
// confirmation line, it never moves money (payee-name confirmation is the anti-wrong-send gate).
const psp = (code: string, name: string): [string, Operator] => [code, { code, name, type: 'psp' }];
const bank = (code: string, name: string): [string, Operator] => [code, { code, name, type: 'bank' }];

export const UPI_HANDLES: ReadonlyMap<string, Operator> = new Map([
  // PSP apps (suffix → the app the payee runs, via its partner bank)
  psp('paytm', 'Paytm'),
  psp('ptyes', 'Paytm'),
  psp('ptaxis', 'Paytm'),
  psp('pthdfc', 'Paytm'),
  psp('ptsbi', 'Paytm'),
  psp('ybl', 'PhonePe'),
  psp('ibl', 'PhonePe'),
  psp('axl', 'PhonePe'),
  psp('okaxis', 'Google Pay'),
  psp('okhdfcbank', 'Google Pay'),
  psp('okicici', 'Google Pay'),
  psp('oksbi', 'Google Pay'),
  psp('apl', 'Amazon Pay'),
  psp('yapl', 'Amazon Pay'),
  psp('rapl', 'Amazon Pay'),
  psp('waaxis', 'WhatsApp Pay'),
  psp('wahdfcbank', 'WhatsApp Pay'),
  psp('waicici', 'WhatsApp Pay'),
  psp('wasbi', 'WhatsApp Pay'),
  psp('axisb', 'CRED'),
  psp('ikwik', 'MobiKwik'),
  psp('fam', 'FamApp'),
  psp('jupiteraxis', 'Jupiter'),
  psp('naviaxis', 'Navi'),
  psp('sliceaxis', 'slice'),
  // Bank-direct handles
  bank('hdfcbank', 'HDFC Bank'),
  bank('icici', 'ICICI Bank'),
  bank('axisbank', 'Axis Bank'),
  bank('sbi', 'State Bank of India'),
  bank('kotak', 'Kotak Mahindra Bank'),
  bank('kmbl', 'Kotak Mahindra Bank'),
  bank('yesbank', 'Yes Bank'),
  bank('idfcbank', 'IDFC FIRST Bank'),
  bank('barodampay', 'Bank of Baroda'),
  bank('pnb', 'Punjab National Bank'),
  // The network's own app
  ['upi', { code: 'upi', name: 'BHIM', type: 'network' }],
]);

/** Identify the operator behind a UPI VPA from its suffix, or undefined if unknown. */
export function vpaOperator(vpa: string): Operator | undefined {
  const at = vpa.lastIndexOf('@');
  if (at < 1) return undefined;
  return UPI_HANDLES.get(vpa.slice(at + 1).trim().toLowerCase());
}
