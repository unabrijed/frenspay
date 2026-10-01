// Singapore QR recognition only. No name verification or permission to initiate a payment.
// PayNow's SG.PAYNOW template can appear alongside other schemes inside SGQR.
export interface PayNowDestination {
  proxyType: 'uen' | 'mobile_number';
  proxyValue: string;
}

export interface PayNowTarget extends PayNowDestination {
  kind: 'paynow';
  name?: string;
  amountSgd?: number;
  amountEditable: boolean;
  reference?: string;
  /** ISO timestamp, interpreted in Singapore time (UTC+08:00). */
  expiresAt?: string;
}

type Fields = Map<string, string>;

/** Strict TLV: complete coverage, nonempty values, unique tags; lengths count characters. */
function fields(text: string): Fields | null {
  const chars = Array.from(text);
  const out: Fields = new Map();
  let i = 0;
  while (i < chars.length) {
    const header = chars.slice(i, i + 4).join('');
    if (!/^\d{4}$/.test(header)) return null;
    const tag = header.slice(0, 2);
    const length = Number(header.slice(2));
    if (!length || out.has(tag) || i + 4 + length > chars.length) return null;
    out.set(tag, chars.slice(i + 4, i + 4 + length).join(''));
    i += 4 + length;
  }
  return out;
}

/** EMV CRC-16/CCITT-FALSE over UTF-8, including the final '6304' header, excluding its value. */
export function emvCrc16(text: string): string {
  let crc = 0xffff;
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    const bytes = cp < 0x80 ? [cp]
      : cp < 0x800 ? [0xc0 | (cp >> 6), 0x80 | (cp & 63)]
      : cp < 0x10000 ? [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]
      : [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
    for (const byte of bytes) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function expiry(value: string): number | null {
  if (!/^\d{8}(\d{6})?$/.test(value)) return null;
  const y = Number(value.slice(0, 4)), m = Number(value.slice(4, 6)), d = Number(value.slice(6, 8));
  const h = value.length === 14 ? Number(value.slice(8, 10)) : 23;
  const min = value.length === 14 ? Number(value.slice(10, 12)) : 59;
  const sec = value.length === 14 ? Number(value.slice(12, 14)) : 59;
  const local = new Date(Date.UTC(y, m - 1, d, h, min, sec, value.length === 8 ? 999 : 0));
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== m - 1 || local.getUTCDate() !== d ||
      local.getUTCHours() !== h || local.getUTCMinutes() !== min || local.getUTCSeconds() !== sec) return null;
  return local.getTime() - 8 * 60 * 60 * 1000;
}

/** Null means not Singapore; unsupported means recognised but unsafe/unsupported, never fall through. */
export function parsePayNowQr(text: string, now = Date.now()): PayNowTarget | { kind: 'unsupported'; reason: string } | null {
  const raw = text.trim();
  if (!raw.startsWith('000201')) return null;
  const root = raw.length <= 4096 ? fields(raw) : null;
  const singapore = /SG\.(PAYNOW|SGQR)/i.test(raw) || root?.get('58') === 'SG';
  if (!singapore) return null;
  const invalid = (detail: string) => ({ kind: 'unsupported' as const, reason: `This Singapore QR ${detail}.` });
  if (!root || root.get('00') !== '01') return invalid('is malformed');
  if (!/6304[0-9A-Fa-f]{4}$/.test(raw) || emvCrc16(raw.slice(0, -4)) !== root.get('63')?.toUpperCase()) {
    return invalid('has an invalid checksum');
  }
  if (root.get('53') !== '702' || root.get('58') !== 'SG') return invalid('must specify SGD and Singapore');
  if (root.has('01') && !['11', '12'].includes(root.get('01')!)) return invalid('has an unsupported initiation method');
  if (['55', '56', '57'].some((tag) => root.has(tag))) return invalid('includes unsupported fee instructions');

  const templates: Fields[] = [];
  for (const [tag, value] of root) {
    if (Number(tag) < 26 || Number(tag) > 51) continue;
    const sub = fields(value);
    if (!sub) return invalid('has a malformed payment template');
    if (sub.get('00')?.toUpperCase() === 'SG.PAYNOW') templates.push(sub);
  }
  if (!templates.length) return invalid('does not include a supported PayNow destination');
  if (templates.length !== 1) return invalid('has conflicting PayNow destinations');
  const sub = templates[0];
  if ([...sub.keys()].some((tag) => !['00', '01', '02', '03', '04', '05'].includes(tag))) {
    return invalid('includes unsupported PayNow instructions');
  }
  const proxyType = sub.get('01') === '2' ? 'uen' : sub.get('01') === '0' ? 'mobile_number' : null;
  if (!proxyType) return invalid('uses an unsupported PayNow proxy type');
  const proxyValue = sub.get('02') ?? '';
  // StraitsX accepts UENs with optional suffix (9–13 alphanumerics) and Singapore mobile numbers.
  if (!(proxyType === 'uen' ? /^[A-Z0-9]{9,13}$/ : /^\+65[89]\d{7}$/).test(proxyValue)) {
    return invalid('has an invalid PayNow destination');
  }
  if (!['0', '1'].includes(sub.get('03') ?? '')) return invalid('has invalid amount instructions');
  const amountEditable = sub.get('03') === '1';
  const amountRaw = root.get('54');
  if (amountRaw !== undefined && (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(amountRaw) || Number(amountRaw) <= 0)) {
    return invalid('has an invalid SGD amount');
  }
  if (!amountEditable && amountRaw === undefined) return invalid('omits its fixed amount');
  const additional = root.has('62') ? fields(root.get('62')!) : new Map<string, string>();
  if (!additional) return invalid('has malformed reference instructions');
  const templateRef = sub.get('05'), additionalRef = additional.get('05');
  if (templateRef && additionalRef && templateRef !== additionalRef) return invalid('has conflicting references');
  const expires = sub.has('04') ? expiry(sub.get('04')!) : undefined;
  if (expires === null) return invalid('has an invalid expiry');
  if (expires !== undefined && expires <= now) return invalid('has expired');
  return {
    kind: 'paynow', proxyType, proxyValue,
    name: root.get('59')?.trim() || undefined,
    amountSgd: amountRaw === undefined ? undefined : Number(amountRaw),
    amountEditable,
    reference: templateRef ?? additionalRef,
    expiresAt: expires === undefined ? undefined : new Date(expires).toISOString(),
  };
}
