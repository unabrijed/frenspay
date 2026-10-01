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
export const PAYOUT_METHODS: readonly string[] = ['UPI', 'QRIS', 'Pix', 'bank', 'PayNow'];

/**
 * A UPI VPA: local@psp, e.g. 'shop@okhdfcbank'. MIRRORS `VPA_RE` in packages/shared/src/payTarget.ts
 * (check-paytarget.ts asserts). The suffix forbids a dot: every real PSP/bank handle is a single
 * label (okaxis, ybl, hdfcbank, …) while an email domain has one — without that,
 * `someone@gmail.com` passed this gate and could be quoted, escrowed, and handed to a merchant.
 */
const VPA_RE = /^[a-z0-9.\-_]{2,}@[a-z0-9\-_]{2,}$/i;

/**
 * Who settles a corridor's fiat leg (docs/23 — the choice is a per-country licensing commitment):
 *   'provider' — the platform settles through its own merchants row (sim_behavior='psp'); a
 *                payout provider (payout_providers registry) executes the fiat leg by API.
 *   'lp'       — the marketplace: rankMerchants picks an external LP who pays by hand and claims.
 *
 * `settle` is an ORDERED PREFERENCE, not a single choice: the first entry that can actually settle
 * wins. Automated settlement beats waking a human every time, so 'provider' leads wherever we could
 * ever have one, and the LP network is the fallback for regions where we don't.
 *
 * Availability is NOT read off a DB row. A corridor listing 'provider' resolves it through
 * services/payout/provider.ts, which requires the row to be enabled AND its credential to resolve
 * (invariant 11 — a row alone is never enough to move money). So today UPI's ['provider','lp']
 * resolves to 'lp' because no INR provider is configured, and the day an India-licensed partner is
 * enabled it flips to provider-first with the LP pool underneath it, with no code change here.
 *
 * `destinationRe` is the ONLY validation between a scanned string and a human/PSP acting on it.
 * A corridor without one cannot take a destination at all.
 */
export interface Corridor {
  /** Quote/fiat currency — the RAIL is the currency authority (docs/21), never users.country. */
  currency: string;
  settle: readonly ('provider' | 'lp')[];
  /** ISO 3166-1 alpha-2. MIRRORS `country` in packages/shared/src/rails.ts, which is the only
   *  country list in this system (invariant 1); check-rails.ts asserts they agree. Routing uses it
   *  as a hard filter so an order is never offered to an LP who cannot serve its corridor. */
  country: string;
  destinationRe?: RegExp;
}

/**
 * Payout methods that exist in the enum but deliberately have NO corridor. A method absent from
 * `CORRIDORS` is registerable as a value but **not quotable and not open to LPs** — the quote route
 * answers `400 unsupported_payout_method` and `acceptsLps` refuses the application at the door.
 *
 * This list is what makes that absence a DECISION rather than an oversight: check-rails.ts requires
 * every PAYOUT_METHOD to be either a corridor key or named here, so a corridor cannot be dropped by
 * accident and cannot be "explained" by a passing mention in a comment.
 *
 *   Pix   — no FX band, no corridor, never built.
 *   bank  — deferred (2026-08-14). It HAD a corridor and could not work with it: no
 *           `destinationRe` means `!undefined?.test(x)` is always true, so any destination was an
 *           unconditional 400, while a destination-less quote would have created a funded order
 *           with nobody to pay the moment a bank LP existed. Meanwhile `acceptsLps` said yes, so a
 *           person could stake against a rail that would never route them anything.
 *
 *           Unblocking it needs a STRUCTURED destination (account number + IFSC + beneficiary name
 *           are three fields; `payout_destination` is one text column) and an answer to the
 *           wrong-send question: a typed account has no independent name check the way a VPA does.
 *           See docs/11-lp-console.md.
 */
// PayNow is recognition + isolated StraitsX sandbox only. No live corridor or Singapore LPs.
export const NOT_QUOTABLE: readonly PayoutMethod[] = ['Pix', 'bank', 'PayNow'];

export const CORRIDORS: Partial<Record<PayoutMethod, Corridor>> = {
  UPI: { currency: 'INR', settle: ['provider', 'lp'], country: 'IN', destinationRe: VPA_RE },
  QRIS: {
    currency: 'IDR',
    settle: ['provider', 'lp'],
    country: 'ID',
    // The merchant proxy off the QR (NMID / merchant PAN): shape varies by acquirer, so bound it
    // to printable, non-@ (never a VPA by accident), sane length.
    destinationRe: /^(?!.*@)[a-z0-9][a-z0-9 .\-/]{4,63}$/i,
  },
};

/** Can a human LP register on / be routed this rail at all? A corridor that never falls back to the
 *  pool has no external LP network to join, and an application on it is refused at the door. */
export const acceptsLps = (rail: PayoutMethod): boolean => !!CORRIDORS[rail]?.settle.includes('lp');
