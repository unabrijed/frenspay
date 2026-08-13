// errors.ts — one catalog mapping backend error codes to human copy, so every surface (toast or
// inline) says the same thing and users never see a raw code / JSON blob. Keyed on ApiError.code
// (services/api.ts throws ApiError with `code` = the backend's `error` string).
import { ApiError } from '@/services/api';

const BY_CODE: Record<string, string> = {
  // sends to outside wallets (cross-chain)
  invalid_recipient: 'That address can’t receive money. Double-check it.',
  self_send_not_allowed: "That's your own wallet",
  unsupported_network: 'fpay can’t send on that network yet.',
  amount_too_small: 'Sends to outside wallets need to be at least $1.',
  too_many_new_recipients: 'You’ve reached today’s limit for new wallets. Try tomorrow.',
  duplicate_request: 'That send is already in progress.',
  crosschain_unavailable: 'Sends to other networks are briefly unavailable. Try again soon.',
  // limits / verification
  limit_exceeded: 'Verify your identity to raise your limits.',
  kyc_required: 'Verify your identity first. Merchants need a verified account.',
  // merchant / LP self-serve (routes/merchant.ts). Every one of these is read by the person who
  // runs the account, so each names the specific wall and what clears it.
  kyb_not_approved: 'Your application is still under review.',
  bond_below_minimum: 'Add to your stake before going back online.',
  merchant_suspended: 'Your merchant account is suspended. Contact support.',
  rail_not_open_to_lps: 'That payment method isn’t open to merchants yet.',
  spread_out_of_band: 'Your margin has to be between 0.10% and 3.00%.',
  withdrawal_already_pending: 'You’ve already asked for some stake back. Cancel that first.',
  insufficient_bond: 'That’s more than your stake.',
  // Deliberately not "you have orders in flight": an open dispute lands here too, and an LP whose
  // bond might still be fined shouldn't be told the only blocker is time.
  orders_in_flight: 'Finish your open orders before taking stake back.',
  withdrawal_not_cancellable: 'That request was already settled.',
  // KYB (0016). 'invalid_kyb_fields' deliberately has no copy of its own — the form red-lines the
  // specific fields the server names, which is more useful than a sentence about the whole form.
  kyb_not_submittable: 'Your details are already with us.',
  kyb_not_decidable: 'Someone else already handled this one.',
  note_required: 'A reason is required — the merchant sees it.',
  // The lock (0015). "Taken" rather than "failed": nothing went wrong, someone was quicker.
  order_already_taken: 'Someone else took this one.',
  order_not_unlockable: 'You’re not holding this order.',
  lock_temporarily_blocked: 'You’ve dropped a few orders lately. Try again in a bit.',
  order_not_claimable: 'This order moved on. Don’t pay it.',
  unsupported_channel: 'We can’t send alerts that way yet.',
  // The vendor session couldn't be started (routes/kyc.ts). The real reason is server-side only,
  // so the copy promises nothing about the cause and points at the one useful action: wait, retry.
  kyc_unavailable: 'Verification is temporarily unavailable. Please try again shortly.',
  // Prod running the sim provider — a misconfiguration the user can never fix by retrying.
  kyc_provider_unavailable: 'Verification isn’t available right now. Please contact support.',
  // Any rate-limited route (services/rateLimit.ts), not just KYC — retrying a failing verify is
  // the fastest way to hit it, which is exactly when a raw code would have surfaced.
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  // funding / faucet
  faucet_empty: 'Test funds are temporarily out. Try again shortly.',
  faucet_disabled: 'Adding test money isn’t available here.',
  wallet_not_found: 'Your wallet is still being set up. Try again in a moment.',
  // account lifecycle
  account_suspended: 'Your account is paused. Contact support to sort it out.',
  account_deleted: 'This account has been deleted. Your money is still yours via your embedded wallet.',
  // signup
  handle_taken: 'That name is already taken. Try another.',
  // Not a handle problem, and no amount of renaming fixes it — wallets.address is unique across
  // every account, so this means the wallet is already linked to a different one.
  wallet_in_use: 'That wallet is already linked to another fpay account.',
  // uq_users_email (0010): one email, one account — admin untangles which keeps the address.
  email_in_use: 'That email is already linked to another fpay account. Contact support.',
};

/** Human copy for any thrown error. ApiError → its code; a plain Error whose message is a known code
 *  also maps. Everything else falls back to a generic line (never the raw code). */
export function friendlyError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof ApiError) return BY_CODE[e.code] ?? fallback;
  if (e instanceof Error && e.message) return BY_CODE[e.message] ?? fallback;
  return fallback;
}

/** The message catalog, exported so callers that branch on a specific code can reuse the same copy. */
export { BY_CODE as ERROR_COPY };
