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
  kyc_required: 'Verify your identity first — merchants need a verified account.',
  // funding / faucet
  faucet_empty: 'Test funds are temporarily out. Try again shortly.',
  faucet_disabled: 'Adding test money isn’t available here.',
  wallet_not_found: 'Your wallet is still being set up. Try again in a moment.',
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
