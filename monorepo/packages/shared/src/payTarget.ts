// payTarget.ts — turn ONE raw string into a payment intent. Pure, no UI / no IO.
//
// This is the single classifier behind every way a payment target enters the app: the QR camera,
// the typed/pasted box on the Scan sheet, and the people search on the Send sheet. It used to live
// in apps/web/src/lib/qr.ts while the Send sheet ran its own smaller, subtly different version —
// which meant the same string could resolve to two different recipients depending on which box you
// typed it into. It lives here so there is exactly one answer, and so a second client gets it free.
//
// Classification only says what a string LOOKS like. What it actually IS — whether that address
// belongs to an fpay user, whether that rail can execute today — is the server's job.

import { classifyAddress } from './chains';
import { parseEmvQr } from './emvqr';
import { looksLikePhone } from './phones';
import { railById } from './rails';

export type PayTarget =
  | { kind: 'handle'; handle: string } // another fpay user → in-app USDC send
  | { kind: 'upi'; payee: string; name?: string; amountInr?: number; note?: string } // Indian shop → merchant rail
  | { kind: 'qris'; payee: string; name?: string; amountIdr?: number } // Indonesian shop (NMID) → merchant rail
  | { kind: 'address'; address: string; network: 'solana' | 'evm' } // raw wallet → on-chain send
  | { kind: 'phone'; number: string } // directory lookup (the caller builds the candidates)
  | { kind: 'unsupported'; reason: string } // recognized but not payable (e.g. a non-USDC request)
  | { kind: 'unknown'; raw: string };

/**
 * A UPI VPA: `local@psp`, e.g. `merchant@okhdfcbank`. No leading '@' — that's our handle form.
 *
 * The suffix deliberately forbids a dot. Every real PSP/bank handle is a single label (see
 * UPI_HANDLES in rails.ts: okaxis, ybl, paytm, hdfcbank, …) while an email domain essentially
 * always has one — and without this, `someone@gmail.com` classified as a shop and could be quoted,
 * escrowed and handed to a merchant to pay. The local part may still contain dots (`john.doe@ybl`).
 */
const VPA_RE = /^[a-z0-9.\-_]{2,}@[a-z0-9\-_]{2,}$/i;

/**
 * Canonical fpay handle, or null. MIRRORS `canonicalHandle` in apps/backend/src/db/queries.ts —
 * the backend is the authority and stores the '@'. Keep the two in step; `check-paytarget.ts`
 * asserts the rule, and a mismatch means a handle that resolves in one place and 404s in the other.
 * Rejects rather than repairs: silently stripping illegal characters turns `@ne-ha` into `@neha`,
 * which is a different real person.
 */
export function canonicalHandle(raw: string): string | null {
  const body = raw.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_.]{3,30}$/.test(body) ? '@' + body : null;
}

/**
 * Repair-as-you-type for choosing your OWN name (the three setup screens): what you see is what
 * registers, capped at the 30 the server allows, without the '@'. The opposite of `canonicalHandle`
 * on purpose — repairing is fine for a name that is yours to pick, and wrong for anyone else's
 * (see above: `@ne-ha` → `@neha` is a different person), so it never touches a lookup, the Send
 * sheet, or an admin field that names someone else.
 */
export const draftHandle = (raw: string): string =>
  raw.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 30);

/** Normalize a scanned/typed handle: strip a deep-link tail (`@neha?x=1`) before canonicalizing. */
function handleFromScan(raw: string): string | null {
  return canonicalHandle(raw.trim().replace(/^@/, '').split(/[?&/\s]/)[0]);
}

/** "TH" → "Thailand"; falls back to the code where Intl lacks the region. */
function regionName(iso: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

/**
 * One query param out of a URI, whether or not the scheme is URL-parseable. Hand-rolled rather than
 * `URLSearchParams` because this package deliberately compiles against `lib: ["ES2022"]` alone —
 * pulling in DOM to get the types would also make `document`/`window` reachable from a package the
 * backend imports. Decodes '+' as space then percent-escapes, the way a query string is defined.
 */
function param(raw: string, key: string): string | undefined {
  const q = raw.indexOf('?');
  if (q === -1) return undefined;
  for (const pair of raw.slice(q + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1 ? pair !== key : pair.slice(0, eq) !== key) continue;
    const value = eq === -1 ? '' : pair.slice(eq + 1).replace(/\+/g, ' ');
    try {
      return decodeURIComponent(value);
    } catch {
      return value; // malformed %-escape: hand back the raw value rather than throwing
    }
  }
  return undefined;
}

export function classifyPayTarget(text: string): PayTarget {
  const raw = (text ?? '').trim();
  if (!raw) return { kind: 'unknown', raw };
  const lower = raw.toLowerCase();

  // 1) UPI deep link: upi://pay?pa=<vpa>&pn=<name>&am=<amount>&tn=<note>
  if (lower.startsWith('upi:')) {
    const payee = (param(raw, 'pa') ?? '').trim();
    if (!payee) return { kind: 'unknown', raw };
    const name = param(raw, 'pn')?.trim() || undefined;
    const amRaw = param(raw, 'am')?.trim();
    const amountInr = amRaw && Number.isFinite(Number(amRaw)) && Number(amRaw) > 0 ? Number(amRaw) : undefined;
    const note = param(raw, 'tn')?.trim() || undefined;
    return { kind: 'upi', payee, name, amountInr, note };
  }

  // 1b) EMVCo merchant QR (PromptPay / Pix / DuitNow / Bharat-QR) — a TLV payload, not a URI.
  // The merchant-account template names the processing network, so we can say exactly what was
  // scanned even when we can't pay it yet.
  if (raw.startsWith('000201')) {
    const t = parseEmvQr(raw);
    if (!t) return { kind: 'unknown', raw };
    // The RAIL is the currency authority: an undeclared tag 53 means the rail's own currency; a
    // declared MISMATCH means never prefill — a foreign-currency amount seeded onto the keypad
    // misprices by orders of magnitude (an unmapped '360' once made Rp read as ₹, ~200×).
    const railCurrency = railById(t.rail).currency;
    const amount = !t.currency || t.currency === railCurrency ? t.amount : undefined;
    if (t.rail === 'upi' && t.kind === 'vpa') {
      // India's EMV merchant codes carry the same VPA as a upi:// link — join the live pay path.
      return { kind: 'upi', payee: t.address, name: t.name, amountInr: amount };
    }
    if (t.rail === 'qris' && t.address) {
      // Indonesia's national template carries the NMID — the payout destination on the QRIS rail.
      return { kind: 'qris', payee: t.address, name: t.name, amountIdr: amount };
    }
    const rail = railById(t.rail);
    return { kind: 'unsupported', reason: `That's a ${rail.name} (${regionName(rail.country)}) code — fpay can't pay ${rail.name} yet.` };
  }

  // 2) Our own deep link: pay:@handle / pay://@handle / pay://u/@handle
  if (lower.startsWith('pay:')) {
    const handle = handleFromScan(raw.replace(/^pay:(\/\/)?(u\/)?/i, ''));
    return handle ? { kind: 'handle', handle } : { kind: 'unknown', raw };
  }

  // 3) Bare app handle: @neha
  if (raw.startsWith('@')) {
    const handle = handleFromScan(raw);
    if (handle) return { kind: 'handle', handle };
  }

  // 4) Solana Pay URI: solana:<recipient>?… → treat the recipient as a raw address.
  if (lower.startsWith('solana:')) {
    // USDC-only rule: a request pinned to a specific token could silently pay the wrong asset if we
    // ignored it — refuse rather than substitute (docs/16 §6.7).
    if (param(raw, 'spl-token')) {
      return { kind: 'unsupported', reason: "This code asks for a payment fpay can't make yet." };
    }
    const address = raw.slice('solana:'.length).split('?')[0].trim();
    const c = classifyAddress(address);
    return c.kind === 'solana' ? { kind: 'address', address: c.address, network: 'solana' } : { kind: 'unknown', raw };
  }

  // 5) EIP-681 EVM URI: ethereum:0x…
  // The same substitution guard as the Solana branch above, which this used to lack: EIP-681 encodes
  // a token transfer as `ethereum:<TOKEN>/transfer?address=<RECIPIENT>`, so taking the part before
  // the '/' as the payee meant sending USDC TO THE TOKEN CONTRACT. Anything carrying a function call
  // or a chain selector is refused rather than reinterpreted.
  if (lower.startsWith('ethereum:')) {
    const body = raw.slice('ethereum:'.length).trim();
    if (/[/@]/.test(body.split('?')[0]) || body.includes('?')) {
      return { kind: 'unsupported', reason: "This code asks for a payment fpay can't make yet." };
    }
    const c = classifyAddress(body);
    return c.kind === 'evm' ? { kind: 'address', address: c.address, network: 'evm' } : { kind: 'unknown', raw };
  }

  // 5b) tel: URI (RFC 3966) → strip params + visual separators. Local format is allowed; the caller
  // resolves via country candidates.
  if (lower.startsWith('tel:')) {
    const number = raw.slice(4).split(';')[0].replace(/[\s().-]/g, '');
    return /^\+?\d{6,15}$/.test(number) ? { kind: 'phone', number } : { kind: 'unknown', raw };
  }

  // 6) Bare UPI VPA (a static shop sticker that's just the VPA)
  if (VPA_RE.test(raw)) return { kind: 'upi', payee: raw };

  // 7) Bare wallet address: base58→32 bytes = Solana; 0x+40hex = EVM family (user picks network).
  const c = classifyAddress(raw);
  if (c.kind !== 'invalid') return { kind: 'address', address: c.address, network: c.kind };

  // 8) Bare phone number (printed contact stickers). Last on purpose: handles start '@' (3),
  // VPAs contain '@' (6), and no 6–15-digit string classifies as a wallet address (7).
  if (looksLikePhone(raw)) return { kind: 'phone', number: raw };

  return { kind: 'unknown', raw };
}
