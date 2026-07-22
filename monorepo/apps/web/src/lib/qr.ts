// qr.ts — turn a scanned QR's raw text into a payment intent. Pure, no UI / no IO, so it's
// unit-testable. The scanner is "dumb": it hands raw text here and the store decides what to do
// (UPI merchant pay vs a Pay-user USDC send vs a direct wallet-address send).

import { classifyAddress, looksLikePhone } from '@fpay/shared';

export type ScanResult =
  | { kind: 'handle'; handle: string } // another Pay user → real USDC send
  | { kind: 'upi'; payee: string; name?: string; amountInr?: number; note?: string } // merchant (Phase-2 mock)
  | { kind: 'address'; address: string; network: 'solana' | 'evm' } // direct wallet-address send
  | { kind: 'phone'; number: string } // pay-by-phone directory lookup (store builds the candidates)
  | { kind: 'unsupported'; reason: string } // recognized but not payable (e.g. token-specific request)
  | { kind: 'unknown'; raw: string };
// A UPI VPA: local@psp, e.g. "merchant@okhdfcbank". No leading '@' (that's our handle form).
const VPA_RE = /^[a-z0-9.\-_]{2,}@[a-z0-9.\-_]{2,}$/i;

/** Normalize "@Neha", "neha?x=1", "u/neha" → "@neha". Returns null if not a plausible handle. */
function normalizeHandle(raw: string): string | null {
  const clean = raw
    .trim()
    .replace(/^@/, '')
    .split(/[?&/\s]/)[0]
    .toLowerCase();
  return /^[a-z0-9_.]{2,30}$/.test(clean) ? '@' + clean : null;
}

/** Pull a query string's params whether or not the scheme is URL-parseable. */
function queryParams(raw: string): URLSearchParams {
  const q = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  return new URLSearchParams(q);
}

export function parseScannedQR(text: string): ScanResult {
  const raw = (text ?? '').trim();
  if (!raw) return { kind: 'unknown', raw };
  const lower = raw.toLowerCase();

  // 1) UPI deep link: upi://pay?pa=<vpa>&pn=<name>&am=<amount>&tn=<note>
  if (lower.startsWith('upi:')) {
    const p = queryParams(raw);
    const payee = (p.get('pa') ?? '').trim();
    if (!payee) return { kind: 'unknown', raw };
    const name = p.get('pn')?.trim() || undefined;
    const amRaw = p.get('am')?.trim();
    const amountInr = amRaw && Number.isFinite(Number(amRaw)) && Number(amRaw) > 0 ? Number(amRaw) : undefined;
    const note = p.get('tn')?.trim() || undefined;
    return { kind: 'upi', payee, name, amountInr, note };
  }

  // 2) Our own Pay deep link: pay:@handle / pay://@handle / pay://u/@handle
  if (lower.startsWith('pay:')) {
    const rest = raw.replace(/^pay:(\/\/)?(u\/)?/i, '');
    const handle = normalizeHandle(rest);
    return handle ? { kind: 'handle', handle } : { kind: 'unknown', raw };
  }

  // 3) Bare app handle: @neha
  if (raw.startsWith('@')) {
    const handle = normalizeHandle(raw);
    if (handle) return { kind: 'handle', handle };
  }

  // 4) Solana Pay URI: solana:<recipient>?... → treat the recipient as a raw address.
  if (lower.startsWith('solana:')) {
    // USDC-only rule: a request pinned to a specific token (spl-token param) could silently pay
    // the wrong asset if we ignored it — refuse rather than substitute (docs/16 §6.7).
    if (queryParams(raw).get('spl-token')) {
      return { kind: 'unsupported', reason: "This code asks for a payment fpay can't make yet." };
    }
    const address = raw.slice('solana:'.length).split('?')[0].trim();
    const c = classifyAddress(address);
    return c.kind === 'solana' ? { kind: 'address', address: c.address, network: 'solana' } : { kind: 'unknown', raw };
  }

  // 5) EIP-681-style EVM URI: ethereum:0x… → surface as an EVM-family address (network TBD by user).
  if (lower.startsWith('ethereum:')) {
    const address = raw.slice('ethereum:'.length).split(/[@/?]/)[0].trim();
    const c = classifyAddress(address);
    return c.kind === 'evm' ? { kind: 'address', address: c.address, network: 'evm' } : { kind: 'unknown', raw };
  }

  // 5b) tel: URI (RFC 3966): tel:+91-98765-43210;phone-context=… → strip params + visual
  // separators. Local-format tel: is allowed — the store resolves via country candidates.
  if (lower.startsWith('tel:')) {
    const number = raw.slice(4).split(';')[0].replace(/[\s().-]/g, '');
    return /^\+?\d{6,15}$/.test(number) ? { kind: 'phone', number } : { kind: 'unknown', raw };
  }

  // 6) Bare UPI VPA (static shop sticker that's just the VPA)
  if (VPA_RE.test(raw)) return { kind: 'upi', payee: raw };

  // 7) Bare wallet address: base58→32 bytes = Solana; 0x+40hex = EVM family (user picks network).
  const c = classifyAddress(raw);
  if (c.kind !== 'invalid') return { kind: 'address', address: c.address, network: c.kind };

  // 8) Bare phone number (printed contact stickers). Last on purpose: handles start '@' (3),
  // VPAs contain '@' (6), and no 6–15-digit string classifies as a wallet address (7).
  if (looksLikePhone(raw)) return { kind: 'phone', number: raw };

  return { kind: 'unknown', raw };
}
