// emvqr.ts — EMVCo merchant-QR parser. PromptPay, Pix, and DuitNow codes are not URI deep links
// like upi://pay; they are EMVCo TLV payloads whose merchant-account template names the network
// (an AID or a reverse-domain GUI). Parsing that template is what "identifies where the payment
// is being processed". Pure string logic, no IO — shared so web and mobile parse identically.
// Legacy schemes retain their existing validation. PayNow uses strict TLV + CRC checks.
import { type RailTarget, vpaOperator } from './rails';
import { parsePayNowQr } from './paynow';

interface Tlv {
  tag: string;
  value: string;
}

/** Parse one TLV run: [2-digit tag][2-digit length][value]…, or null if it doesn't cover `s` exactly. */
function tlv(s: string): Tlv[] | null {
  const out: Tlv[] = [];
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length || !/^\d{4}$/.test(s.slice(i, i + 4))) return null;
    const len = Number(s.slice(i + 2, i + 4));
    if (i + 4 + len > s.length) return null;
    out.push({ tag: s.slice(i, i + 2), value: s.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return out;
}

const get = (fields: Tlv[], tag: string) => fields.find((f) => f.tag === tag)?.value;

// EMV tag 53 is a numeric ISO 4217 code; we only name the scan-and-pay currencies. A rail's code
// missing here is not cosmetic: the classifier treats an unmapped currency as undeclared, and an
// undeclared currency defaults to the RAIL's own — '360' absent once meant Rp seeded a ₹ keypad.
const NUMERIC_CURRENCY: Record<string, string> = { '356': 'INR', '360': 'IDR', '764': 'THB', '986': 'BRL', '458': 'MYR', '702': 'SGD' };

/** PromptPay proxy "0066812345678" → "+66812345678"; national IDs / e-wallet IDs pass through. */
const promptPayPhone = (v: string) => '+' + v.replace(/^00/, '');

/** Classify a Pix key by shape: email, +phone, CPF/CNPJ digits, or a random (EVP) UUID key. */
function pixKind(key: string): RailTarget['kind'] {
  if (key.includes('@')) return 'email';
  if (key.startsWith('+')) return 'phone';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return 'random-key';
  if (/^\d{11}$|^\d{14}$/.test(key)) return 'national-id';
  return 'merchant';
}

/** Identify the rail + proxy inside one merchant-account template, or null if it names no rail we know. */
function railFromTemplate(sub: Tlv[]): Omit<RailTarget, 'name' | 'amount' | 'currency'> | null {
  const gui = (get(sub, '00') ?? '').trim();
  const guiUpper = gui.toUpperCase();

  // Thailand — PromptPay AID (…0111 personal, …0112 biller). Proxy: 01 phone / 02 national id / 03 e-wallet.
  if (guiUpper.startsWith('A00000067701')) {
    const phone = get(sub, '01');
    const natId = get(sub, '02');
    const wallet = get(sub, '03');
    if (phone) return { rail: 'promptpay', kind: 'phone', address: promptPayPhone(phone) };
    if (natId) return { rail: 'promptpay', kind: 'national-id', address: natId };
    if (wallet) return { rail: 'promptpay', kind: 'e-wallet', address: wallet };
    return { rail: 'promptpay', kind: 'merchant', address: '' };
  }

  // Brazil — Pix GUI. 01 = the key (email/phone/CPF/EVP); 25 = dynamic-QR URL.
  if (gui.toLowerCase() === 'br.gov.bcb.pix') {
    const key = get(sub, '01');
    if (key) return { rail: 'pix', kind: pixKind(key), address: key };
    const url = get(sub, '25');
    if (url) return { rail: 'pix', kind: 'merchant', address: url };
    return null;
  }

  // Malaysia — DuitNow (PayNet AIDs). Proxy layout varies by acquirer; first non-GUI value is the id.
  if (guiUpper.startsWith('A000000615')) {
    const proxy = sub.find((f) => f.tag !== '00')?.value ?? '';
    return { rail: 'duitnow', kind: 'merchant', address: proxy };
  }

  // Indonesia — QRIS. Every QRIS code carries Bank Indonesia's national template (canonically in
  // root tag 51) alongside acquirer-specific ones (tag 26+, e.g. ID.CO.SHOPEE.WWW — those name no
  // rail we know, so the loop walks on to this one). Sub-tag 01 is the 15-char PTEN-issued NMID
  // ("ID" + digits), the stable national merchant id; 03 is the business-size criteria (UMI/UKE/…).
  // GPNQR is the domestic-scheme sibling GUI seen in the wild on the same template.
  if (guiUpper === 'ID.CO.QRIS.WWW' || guiUpper === 'ID.OR.GPNQR.WWW') {
    const nmid = get(sub, '01') ?? sub.find((f) => f.tag !== '00')?.value ?? '';
    return { rail: 'qris', kind: 'merchant', address: nmid };
  }

  // India — Bharat QR / UPI merchant template carries the VPA alongside the AID.
  if (guiUpper.startsWith('A000000524')) {
    const addr = sub.find((f) => f.value.includes('@'))?.value;
    if (addr) return { rail: 'upi', kind: 'vpa', address: addr, operator: vpaOperator(addr) };
    return null;
  }

  return null;
}

/** Parse an EMVCo merchant QR payload into a RailTarget, or null if it isn't one / names no known rail. */
export function parseEmvQr(text: string): RailTarget | null {
  const raw = (text ?? '').trim();
  // Tag 00 (payload format indicator) = "01" is the EMVCo signature; anything else isn't an EMV QR.
  if (!raw.startsWith('000201')) return null;
  const paynow = parsePayNowQr(raw);
  if (paynow) return paynow.kind === 'paynow'
    ? { rail: 'paynow', kind: paynow.proxyType === 'uen' ? 'merchant' : 'phone', address: paynow.proxyValue,
        name: paynow.name, amount: paynow.amountSgd, currency: 'SGD' }
    : null;
  const root = tlv(raw);
  if (!root) return null;

  // Merchant-account templates occupy tags 02–51; the first one naming a rail we know wins.
  for (const f of root) {
    const n = Number(f.tag);
    if (n < 2 || n > 51) continue;
    const sub = tlv(f.value);
    if (!sub) continue;
    const found = railFromTemplate(sub);
    if (!found) continue;

    const amountRaw = get(root, '54');
    const amount = amountRaw && Number.isFinite(Number(amountRaw)) && Number(amountRaw) > 0 ? Number(amountRaw) : undefined;
    return {
      ...found,
      name: get(root, '59')?.trim() || undefined,
      amount,
      currency: NUMERIC_CURRENCY[get(root, '53') ?? ''],
    };
  }
  return null;
}
