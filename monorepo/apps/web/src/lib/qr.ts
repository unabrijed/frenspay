// qr.ts — turn a scanned QR's raw text into a payment intent. Pure, no UI / no IO, so it's
// unit-testable. The scanner is "dumb": it hands raw text here and the store decides what to do
// (UPI merchant pay vs a Pay-user USDC send vs an unsupported address).

export type ScanResult =
  | { kind: 'handle'; handle: string } // another Pay user → real USDC send
  | { kind: 'upi'; payee: string; name?: string; amountInr?: number; note?: string } // merchant (Phase-2 mock)
  | { kind: 'address'; address: string } // bare Solana address — not payable by handle yet
  | { kind: 'unknown'; raw: string };

// Base58 (no 0 O I l) at Solana pubkey length.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
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

  // 4) Solana Pay URI: solana:<recipient>?... → treat the recipient as a raw address
  if (lower.startsWith('solana:')) {
    const address = raw.slice('solana:'.length).split('?')[0].trim();
    return BASE58_RE.test(address) ? { kind: 'address', address } : { kind: 'unknown', raw };
  }

  // 5) Bare UPI VPA (static shop sticker that's just the VPA)
  if (VPA_RE.test(raw)) return { kind: 'upi', payee: raw };

  // 6) Bare base58 Solana address
  if (BASE58_RE.test(raw)) return { kind: 'address', address: raw };

  return { kind: 'unknown', raw };
}
