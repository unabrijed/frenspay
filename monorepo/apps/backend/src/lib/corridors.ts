// corridors.ts — the backend's per-rail corridor registry: currency, settlement model, and the
// payout-destination gate, in one place (docs/23). Replaces lib/rails.ts (RAIL_CURRENCY) and the
// DESTINATION_RE table that lived in routes/orders.ts.
//
// MIRRORS packages/shared/src/contracts.ts PAYOUT_METHODS and the rail currencies in
// packages/shared/src/rails.ts — the backend can only `import type` from @fpay/shared (see
// lib/units.ts header), so runtime values are copied at the trust boundary. check-rails.ts and
// check-paytarget.ts assert the copies stay in step.
import type { PayoutMethod } from '@fpay/shared';

/** Every rail an LP can register / a quote can name. Keep in step with the DB CHECKs (0004, 0005).
 *  Typed wide (`string[]`) because it validates raw request bodies. */
export const PAYOUT_METHODS: readonly string[] = ['UPI', 'QRIS', 'Pix', 'bank'];

/**
 * A UPI VPA: local@psp, e.g. 'shop@okhdfcbank'. MIRRORS `VPA_RE` in packages/shared/src/payTarget.ts
 * (check-paytarget.ts asserts). The suffix forbids a dot: every real PSP/bank handle is a single
 * label (okaxis, ybl, hdfcbank, …) while an email domain has one — without that,
 * `someone@gmail.com` passed this gate and could be quoted, escrowed, and handed to a merchant.
 */
const VPA_RE = /^[a-z0-9.\-_]{2,}@[a-z0-9\-_]{2,}$/i;

/**
 * Who settles a corridor's fiat leg (docs/23 — the choice is a per-country licensing commitment):
 *   'lp'       — the marketplace: rankMerchants picks an external LP who pays and claims.
 *   'provider' — the platform settles through its own merchants row (sim_behavior='psp'); a
 *                payout provider (payout_providers registry) executes the fiat leg, and external
 *                LP applications are refused on the rail.
 * `destinationRe` is the ONLY validation between a scanned string and a human/PSP acting on it.
 * A corridor without one cannot take a destination at all.
 */
export interface Corridor {
  /** Quote/fiat currency — the RAIL is the currency authority (docs/21), never users.country. */
  currency: string;
  model: 'lp' | 'provider';
  destinationRe?: RegExp;
}

/** A method absent here is registerable but not quotable (Pix: no corridor, no FX band) — the
 *  quote route answers 400, not a guess. 'bank' is an LP settlement method inside the India
 *  corridor, so it prices in INR. */
export const CORRIDORS: Partial<Record<PayoutMethod, Corridor>> = {
  UPI: { currency: 'INR', model: 'lp', destinationRe: VPA_RE },
  bank: { currency: 'INR', model: 'lp' },
  QRIS: {
    currency: 'IDR',
    model: 'provider',
    // The merchant proxy off the QR (NMID / merchant PAN): shape varies by acquirer, so bound it
    // to printable, non-@ (never a VPA by accident), sane length.
    destinationRe: /^(?!.*@)[a-z0-9][a-z0-9 .\-/]{4,63}$/i,
  },
};
