// errors.ts — one catalog mapping backend error codes to human copy, so every surface (toast or
// inline) says the same thing and users never see a raw code / JSON blob. Keyed on ApiError.code
// (services/api.ts throws ApiError with `code` = the backend's `error` string).
import { ApiError } from '../services/api';

const BY_CODE: Record<string, string> = {
  // sends to outside wallets (cross-chain)
  invalid_recipient: 'That address can’t receive money. Double-check it.',
  self_send_not_allowed: "That's your own wallet",
  unsupported_network: 'fpay can’t send on that network yet.',
  // Shared by /orders/quote and the outside-wallet sends (both floor at $1), so the line names neither.
  amount_too_small: 'That’s under the $1 minimum.',
  too_many_new_recipients: 'You’ve reached today’s limit for new wallets. Try tomorrow.',
  duplicate_request: 'That send is already in progress.',
  crosschain_unavailable: 'Sends to other networks are briefly unavailable. Try again soon.',
  // Every Solana-backed call collapses into this one code — /balance as well as the send paths, so
  // the copy can't promise anything about which. Same sentence as the LP console's catalog, because
  // it is the same backend code and the two apps saying different things is how copy drifts.
  solana_unavailable: 'Couldn’t reach the network. Try again in a moment.',
  // POST /orders/quote + /orders while the escrow pool is unconfigured (config.escrowLive false).
  payments_unavailable: 'Payments are paused right now. Try again later.',
  // Routing found nowhere to send it. Says nothing about who would have (invariant 21).
  no_merchant: 'Can’t send to this ID right now. Try again in a few minutes.',
  // The phone app cannot complete a payment in sponsored mode (no backend fee-payer, Privy's Expo SDK
  // cannot sponsor). Not a network blip, so the copy points at the way that works.
  sponsorship_unsupported: 'Payments aren’t available in the phone app yet — use the web app for this one.',
  // limits / verification
  limit_exceeded: 'Verify your identity to raise your limits.',
  kyc_required: 'Verify your identity first to scan and pay.',
  // The vendor session couldn't be started (routes/kyc.ts). The real reason is server-side only,
  // so the copy promises nothing about the cause and points at the one useful action: wait, retry.
  kyc_unavailable: 'Verification is temporarily unavailable. Please try again shortly.',
  // Prod running the sim provider — a misconfiguration the user can never fix by retrying.
  kyc_provider_unavailable: 'Verification isn’t available right now. Please contact support.',
  // Any rate-limited route (services/rateLimit.ts), not just KYC — retrying a failing verify is
  // the fastest way to hit it, which is exactly when a raw code would have surfaced.
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  wallet_not_found: 'Your wallet is still being set up. Try again in a moment.',
  // The bridge's bounded wait gave up (wallet iframe blocked, creation wedged) — the handle screen
  // shows this with a reload; the phone app cannot reload, so the copy stays neutral.
  wallet_not_ready: 'Your wallet is taking longer than usual to set up. Please try again.',
  // account lifecycle
  account_suspended: 'Your account is paused. Contact support to sort it out.',
  account_deleted: 'This account has been deleted. Your money is still yours via your embedded wallet.',
  // signup
  handle_taken: 'That name is already taken. Try another.',
  invalid_handle: 'Use 3–30 letters, numbers, dots or underscores.',
  // Not a handle problem, and no amount of renaming fixes it — wallets.address is unique across
  // every account, so this means the wallet is already linked to a different one.
  wallet_in_use: 'That wallet is already linked to another fpay account.',
  // uq_users_email (0010): one email, one account — admin untangles which keeps the address.
  email_in_use: 'That email is already linked to another fpay account. Contact support.',
  // trips & splitting (docs/04 §Trips)
  unknown_handle: 'Nobody on fpay has that name. Check the spelling.',
  invalid_name: 'Give it a name — up to 40 characters.',
  group_not_found: 'That trip isn’t yours to change, or it’s gone.',
  transfer_not_found: 'Only the person who paid can split or move this.',
  invalid_share: 'Each friend once, and not yourself.',
  shares_exceed_amount: 'The parts add up to more than the bill.',
  share_already_paid: 'One of them already paid their part — leave them out.',
  is_settlement: 'That payment settled a share; it can’t be split or moved.',
  transfer_failed: 'That payment didn’t go through, so there’s nothing to split.',
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
