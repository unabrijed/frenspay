// rails.ts — the backend's payout-rail vocabulary. MIRRORS packages/shared/src/contracts.ts
// PAYOUT_METHODS and the rail currencies in packages/shared/src/rails.ts — the backend can only
// `import type` from @fpay/shared (see lib/units.ts header), so runtime values are copied at the
// trust boundary. check-rails.ts asserts the copies stay in step.
import type { PayoutMethod } from '@fpay/shared';

/** Every rail an LP can register / a quote can name. Keep in step with the DB CHECKs (0004).
 *  Typed wide (`string[]`) because it validates raw request bodies. */
export const PAYOUT_METHODS: readonly string[] = ['UPI', 'QRIS', 'Pix', 'bank'];

/**
 * Quote/fiat currency per payout rail — the RAIL is the currency authority, never the user's
 * country and never a QR's own claim (docs/18, docs/21). A rail absent here is registerable but
 * not yet quotable (Pix: no corridor, no FX band) — the quote route answers 400, not a guess.
 * 'bank' is an LP settlement method inside the India corridor, so it prices in INR.
 */
export const RAIL_CURRENCY: Partial<Record<PayoutMethod, string>> = {
  UPI: 'INR',
  QRIS: 'IDR',
  bank: 'INR',
};
