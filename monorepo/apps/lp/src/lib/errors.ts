// errors.ts — one catalog mapping backend error codes to human copy, so every surface says the same
// thing and an LP never sees a raw code. Keyed on ApiError.code.
//
// This is the LP-side subset. The payer app has its own catalog; the two share no codes, because
// the routes behind them are disjoint — which is the point of the console being its own app.
import { ApiError } from '@/services/api';

const BY_CODE: Record<string, string> = {
  // stake withdrawals + leaving (docs/15)
  recent_payout: 'Not yet — a payout you handled is still inside its dispute window. Try again in a few days.',
  already_exited: 'You’ve already left.',
  // Applying, and the identity gate in front of it.
  kyc_required: 'Verify your identity first — we need that before you can settle payouts.',
  already_a_merchant: 'You already have a partner account.',
  invalid_treasury_address: 'That doesn’t look like a valid Solana address.',
  invalid_rail: 'That payment method isn’t available.',
  not_a_merchant: 'You don’t have a partner account yet.',
  kyb_not_approved: 'Your application is still under review.',
  bond_below_minimum: 'Add to your stake before going back online.',
  merchant_suspended: 'Your partner account is suspended. Contact support.',
  rail_not_open_to_lps: 'That payment method isn’t open to partners yet.',
  spread_out_of_band: 'Your margin has to be between 0.10% and 3.00%.',
  withdrawal_already_pending: 'You’ve already asked for some stake back. Cancel that first.',
  insufficient_bond: 'That’s more than your stake.',
  orders_in_flight: 'Finish your open orders before taking stake back.',
  withdrawal_not_cancellable: 'That request was already settled.',
  kyb_not_submittable: 'Your details are already with us.',
  kyb_not_decidable: 'Someone else already handled this one.',
  note_required: 'A reason is required — the partner sees it.',
  order_already_taken: 'Someone else took this one.',
  order_not_unlockable: 'You’re not holding this order.',
  lock_temporarily_blocked: 'You’ve dropped a few orders lately. Try again in a bit.',
  order_not_claimable: 'This order moved on. Don’t pay it.',
  missing_phone: 'Add a number we can reach you on.',
  invalid_phone: 'That does not look like a phone number. Include the country code, like +91.',
  unsupported_channel: 'We can’t send alerts that way yet.',
  // Money movement out of their own wallet.
  staking_unavailable: 'Staking is temporarily unavailable. Try again shortly.',
  solana_unavailable: 'Couldn’t reach the network. Try again in a moment.',
  sponsorship_unsupported: 'Staking isn’t available from this device yet — use the web console for this one.',
  amount_too_large: 'That’s more than you can stake in one go.',
  invalid_amount: 'Enter a valid amount.',
  wallet_not_found: 'Your wallet is still being set up. Try again in a moment.',
  // Session.
  account_suspended: 'Your account is paused. Contact support to sort it out.',
  account_deleted: 'This account has been deleted.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
};

/** Human copy for any thrown error, never the raw code. */
export function friendlyError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof ApiError) return BY_CODE[e.code] ?? fallback;
  if (e instanceof Error && e.message) return BY_CODE[e.message] ?? fallback;
  return fallback;
}

export { BY_CODE as ERROR_COPY };
