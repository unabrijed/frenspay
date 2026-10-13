import { emvCrc16 } from './paynow';

export interface UpiQr {
  vpa: string; name: string; amountInr?: string; category?: string; city?: string;
  format: 'uri' | 'emv';
}
const vpaPattern = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/;
const amountPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
export function validInrAmount(value: unknown): value is string {
  return typeof value === 'string' && amountPattern.test(value) && /[1-9]/.test(value);
}
/** QR metadata is unverified. This parser never resolves links or contacts a bank. */
export function parseUpiQr(raw: unknown): UpiQr | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  const text = raw.trim();
  if (/^upi:/i.test(text)) {
    try {
      const uri = /^upi:\/\/pay\/?\?([^#\s]*)$/i.exec(text);
      if (!uri || /%(?![\da-f]{2})/i.test(text)) return null;
      const fields = new Map<string, string>();
      for (const part of uri[1].split('&')) {
        const separator = part.indexOf('=');
        if (separator < 1) return null;
        const key = decodeURIComponent(part.slice(0, separator).replace(/\+/g, ' '));
        const value = decodeURIComponent(part.slice(separator + 1).replace(/\+/g, ' '));
        if (fields.has(key)) return null;
        fields.set(key, value);
      }
      const vpa = (fields.get('pa') || '').trim().toLowerCase();
      const amount = fields.get('am') ?? null;
      if (!vpaPattern.test(vpa) || (fields.has('cu') && fields.get('cu') !== 'INR') ||
          (amount !== null && !validInrAmount(amount))) return null;
      return { vpa, name: (fields.get('pn') || vpa).trim().slice(0, 128),
        amountInr: amount ?? undefined, category: /^\d{4}$/.test(fields.get('mc') || '') ? fields.get('mc')! : undefined,
        format: 'uri' };
    } catch { return null; }
  }
  if (!text.startsWith('000201') || !/6304[\da-f]{4}$/i.test(text) ||
      emvCrc16(text.slice(0, -4)).toUpperCase() !== text.slice(-4).toUpperCase()) return null;
  const fields = new Map<string, string>();
  for (let i = 0; i < text.length;) {
    if (!/^\d{4}$/.test(text.slice(i, i + 4))) return null;
    const tag = text.slice(i, i + 2), length = Number(text.slice(i + 2, i + 4));
    if (fields.has(tag) || i + 4 + length > text.length) return null;
    fields.set(tag, text.slice(i + 4, i + 4 + length)); i += 4 + length;
  }
  let address = '';
  for (const [tag, value] of fields) {
    if (Number(tag) < 2 || Number(tag) > 51) continue;
    const sub = new Map<string, string>();
    for (let i = 0; i < value.length;) {
      if (!/^\d{4}$/.test(value.slice(i, i + 4))) { sub.clear(); break; }
      const key = value.slice(i, i + 2), length = Number(value.slice(i + 2, i + 4));
      if (sub.has(key) || i + 4 + length > value.length) { sub.clear(); break; }
      sub.set(key, value.slice(i + 4, i + 4 + length)); i += 4 + length;
    }
    if (sub.get('00')?.toUpperCase().startsWith('A000000524')) {
      const candidates = [...sub.values()].filter(v => vpaPattern.test(v));
      if (candidates.length !== 1 || address) return null;
      address = candidates[0];
    }
  }
  const amount = fields.get('54');
  if (!vpaPattern.test(address) ||
      (fields.has('53') && fields.get('53') !== '356') ||
      (fields.has('58') && fields.get('58') !== 'IN') ||
      (amount !== undefined && !validInrAmount(amount))) return null;
  return { vpa: address.toLowerCase(), name: (fields.get('59') || address).slice(0, 128),
    amountInr: amount, category: /^\d{4}$/.test(fields.get('52') || '') ? fields.get('52') : undefined,
    city: fields.get('60')?.trim().slice(0, 128) || undefined, format: 'emv' };
}
