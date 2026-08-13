// contracts.ts — the client/server contract shared by mobile and backend.
// Mirrors the "thin interface" seam from backend-architecture.md so the same
// types describe the mock providers (today) and the real Railway API (Phase 1).

export type TxnType = 'pay' | 'send' | 'add';

export interface Txn {
  id: string; // local id (mock) or transfers.id uuid (real)
  type: TxnType;
  title: string;
  time: string;
  usd: number; // signed: negative = outgoing, positive = top-up
  rupees?: number; // merchant pays only
  status?: 'pending' | 'confirmed' | 'failed'; // real-mode only; optional so mobile (never sets it) is unaffected
}

/**
 * Who receives the fiat leg — the shop/person behind a scanned UPI QR. NOT the same thing as the
 * `merchants` table, which is the LP/agent that settles that leg (`Quote.merchantName`). Two meanings
 * of "merchant" on one money path is a bug waiting to happen, so the payee side is named `Payee`.
 * `vpa` is optional because a payee can come from a mock/demo with no UPI ID; the server re-validates
 * it at quote time, which is the actual trust boundary.
 */
export interface Payee {
  name: string;
  /** The payout destination on the rail — a UPI VPA, or a QRIS NMID. (Named for the India-only
   *  era; it is rail-generic now.) */
  vpa?: string;
  /** Payout rail + its fiat currency. Absent = the UPI/INR default, so every pre-corridor caller
   *  and persisted value keeps working unchanged. */
  rail?: PayoutMethod;
  currency?: string;
}

/** @deprecated Use {@link Payee}. Retained so apps/mobile (mock settlement path) compiles unchanged. */
export type Merchant = Payee;

export interface Friend {
  name: string;
  handle: string;
  ini: string;
}

/** A rate locked at authorization — backs the rate-lock card and Phase-2 fx_rate_locks. */
export interface RateLockQuote {
  rupees: number;
  usdc: number;
  rate: number;
  rateLabel: string;
  quotedAt: number;
  expiresAt: number;
}

/** Phase 1: self-custodial USDC wallet + user-to-user transfers. */
export interface WalletProvider {
  getBalanceUsd(): Promise<number>;
  getTransactions(): Promise<Txn[]>;
  resolveHandle(handle: string): Promise<Friend | null>;
  /** Pay-by-phone directory lookup (normalized E.164). Optional — mock/mobile providers omit it. */
  resolvePhone?(phone: string): Promise<Friend | null>;
  transfer(input: {
    toHandle?: string;
    toAddress?: string;
    amountUsd: number;
    note?: string;
    idempotencyKey?: string;
  }): Promise<Txn>;
  depositAddress(): string;
  /** Devnet faucet: mint test USDC into the caller's own wallet. Optional (real/devnet only). */
  addMoney?(amountUsd: number): Promise<Txn>;
  // ---- payment requests ----
  getRequests(): Promise<ApiPaymentRequest[]>;
  createRequest(input: CreateRequestRequest): Promise<ApiPaymentRequest>;
  /** Mark an incoming request paid, linking the transfer that fulfilled it. */
  payRequest(requestId: string, transferId: string): Promise<void>;
  /** Cancel an outgoing request the caller created. */
  cancelRequest(requestId: string): Promise<void>;
}

/** Phase 2: licensed USDC→INR settlement. quoteSpend locks a rate; executeSpend debits USDC. */
export interface SettlementProvider {
  quoteSpend(input: { merchantRef: string; rupees: number }): Promise<RateLockQuote>;
  executeSpend(quote: RateLockQuote): Promise<{ settled: true; usdDebited: number; rupees: number }>;
}

/* ---- Phase-1 Core API DTOs (backend-architecture.md §2) ---- */
export interface MeResponse {
  id: string;
  handle: string;
  displayName: string;
  walletAddress: string;
  kycTier: number; // M5: 0 restricted · 1 basic/P2P · 2 verified/merchant-pay · 3 enhanced
  kycStatus?: KycStatus; // M7: vendor verification lifecycle (undefined when no check has started)
  /** E.164 pay-by-phone alias — present iff the user opted in. Only ever the caller's OWN number. */
  phone?: string;
  /** Dialing-default country (ISO alpha-2) — drives local-format phone normalization client-side. */
  country?: string;
  /** Server-stored display-currency choice (0011). Null = not chosen — client defaults to USD. */
  preferredCurrency: string | null;
  /** Pinned local (second-line) currency. Null = automatic — derived from `country`. */
  localCurrency: string | null;
  /** The user's EVM deposit address (smart wallet; same on every supported network), once synced. */
  evmDepositAddress?: string;
  /** Present iff this user also runs a merchant/LP account — the whole merchant-role signal. Rides
   *  on /me (already fetched on boot and on the KYC poll) rather than a second endpoint, so the 99%
   *  who aren't merchants pay nothing for it. */
  merchant?: MerchantProfile;
  /** Coarse role for the admin viewer; 'merchant' is informational (capability = `merchant` field). */
  role?: 'user' | 'merchant' | 'admin';
  /** How many invite codes this user owns (3 at signup; admin can mint more). /me only. */
  invitesTotal?: number;
  /** How many of them have been burned by someone signing up. /me only. */
  invitesUsed?: number;
  /** The code strings themselves — present ONLY until the reveal screen is acknowledged
   *  (POST /me/invites/ack), then never again. The server, not the client, enforces that: once
   *  `users.invites_revealed_at` is stamped this field stops being populated. Admin keeps a
   *  permanent view; the user gets one look. */
  invites?: string[];
}

/* ---- merchant (LP) DTOs ---- */

export interface MerchantProfile {
  id: string;
  name: string;
  kybStatus: 'pending' | 'approved' | 'rejected';
  status: 'online' | 'offline' | 'suspended';
  payoutRail: PayoutMethod;
  treasuryAddress: string;
  /** Staked USDC — skin in the game. Slashed on an upheld dispute; below the floor the LP is
   *  auto-suspended out of routing. */
  bondUsdc: string;
  minBondUsdc: string;
  /** How much the LP can have in flight at once. */
  floatUsdc: string;
  /** Live smoothed reputation signals (fractions 0–1) — shown only to the merchant themselves. */
  successRate: number;
  disputeRate: number;
  positiveRate: number;
}

/** One order assigned to this merchant, flattened for the queue screen (fiat leg + payee). */
export interface MerchantOrder {
  id: string;
  referenceCode: string;
  state: OrderState;
  resolution: OrderResolution | null;
  /** ISO 4217 fiat of the leg the LP pays out (see Quote.currency). */
  currency: string;
  amountInr: string;
  amountUsdc: string;
  /** The payee's real UPI ID — what the merchant actually pays. */
  payoutDestination?: string;
  payoutName?: string;
  payoutMethod: PayoutMethod;
  payoutUtr?: string;
  payoutClaimedAt?: string; // ISO 8601
  /** When the escrow auto-releases (dispute window) or when the claim SLA runs out. */
  expiresAt?: string; // ISO 8601
  createdAt: string; // ISO 8601
}

export interface MerchantOrdersResponse {
  orders: MerchantOrder[];
}

/** The merchant's hand-entered proof that they paid the fiat leg out-of-band. */
export interface SubmitPayoutRequest {
  /** UTR / bank reference. Typed by hand — no real payout rail is integrated (docs/11). */
  reference: string;
}

export interface StakePrepareRequest {
  amountUsd: string | number;
}

/** M7: lifecycle of a real-vendor identity check. */
export type KycStatus = 'none' | 'pending' | 'in_review' | 'approved' | 'declined';

/** M7 real vendor: the backend creates a session and returns a hosted verification URL the client opens. */
export interface KycStartResponse {
  url: string;
  sessionId: string;
}

/** Dev/sim vendor: instant tier promote (no hosted flow). */
export interface KycSimVerifyResponse {
  ok: true;
  kycTier: number;
}

/** `POST /kyc/verify` returns one of two shapes depending on the configured provider. */
export type KycVerifyResponse = KycSimVerifyResponse | KycStartResponse;

/** 403 body when a money-movement action exceeds the user's KYC-tier limit (M5). */
export interface LimitExceededError {
  error: 'limit_exceeded';
  kind: 'send' | 'cash_out';
  currentTier: number;
  requiredTier: number;
  limitUsd: number;
  reason: string;
}

/** M6: an in-app notification (everyday-app inbox). */
export interface Notification {
  id: string;
  kind: string; // payment_sent | received | refunded | request_paid | kyc_upgraded
  title: string;
  body: string | null;
  meta?: Record<string, unknown>;
  read: boolean;
  createdAt: string; // ISO 8601
}

export interface NotificationsResponse {
  notifications: Notification[];
  unread: number;
  /** Keyset cursor for the next page; absent on the last page. Pass back as ?cursor=. */
  nextCursor?: string;
}

/** POST /auth/sync body — token in the Authorization header identifies the Privy user. */
export interface AuthSyncRequest {
  handle: string;
  walletAddress: string;
  /** ISO 3166-1 alpha-2 browser-locale guess; server fills only when unset (weakest source). */
  country?: string;
  /** A one-time invite code ('FP-XXXX-XXXX'). Server-required only when this sync CREATES the
   *  account, and burned inside that same transaction. Accepts what a human types — the server
   *  canonicalizes case, spacing and a missing prefix. */
  inviteCode?: string;
}

/** POST /waitlist body (public, landing page). city = the demo-rate corridor selected at signup.
 *
 *  There is no separate "check this code" call any more. Checking and burning have to happen under
 *  one lock — a pre-flight that returns "good" and a write that spends it are two moments, and two
 *  people can fit between them. This route is the only door onto the f list. */
export interface WaitlistJoinRequest {
  email: string;
  /** REQUIRED. A one-time invite code ('FP-XXXX-XXXX'), spent by this call. Accepts what a human
   *  types — the server canonicalizes case, spacing, a missing prefix and Crockford's I/L/O. */
  code: string;
  city?: string;
  /** Who sent them: an app user's '@handle' or another f-list member's ref code. Unknown values are
   *  dropped server-side rather than rejected — a typo'd invite must never block a signup. */
  ref?: string;
}

/** POST /waitlist response. Still 201 for a duplicate EMAIL (so the form can't enumerate the list);
 *  a bad code is 404 and a spent one is 409, which leaks nothing the caller didn't already hold. */
export interface WaitlistJoinResponse {
  ok: true;
  /** This member's own share code for `?ref=`. Null while WAITLIST_SECRET is unset (no codes minted). */
  code: string | null;
  /** 1-based place in the queue. */
  position: number;
  /** How many people joined using this member's code. */
  frens: number;
  /** Their own three invite codes, to pass on. Stable across re-submits — joining twice returns the
   *  same three and spends no second code. Empty only if minting hit the ~1e-8 collision. */
  invites: string[];
}

export interface BalanceResponse {
  balanceUsd: string;
}

export interface ResolveHandleResponse {
  user: Friend | null;
}

/**
 * Wire shape for a transaction as returned by the API. Distinct from the UI `Txn`:
 * the server carries an unsigned magnitude + explicit direction + ISO timestamp and a
 * uuid id; the mobile layer maps this to the view `Txn` (signed usd, formatted time).
 */
export interface ApiTxn {
  id: string; // transfers.id (uuid)
  kind: TxnType;
  direction: 'in' | 'out';
  amountUsd: string; // unsigned magnitude
  counterpartyHandle?: string;
  /** Raw wallet address of the other side when it isn't an fpay user (external sends). */
  counterpartyAddress?: string;
  /** Network the transfer settled on ('solana' today; EVM ids arrive with v2). */
  chain?: string;
  note?: string;
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: string; // ISO 8601
  signature?: string;
}

export interface TransactionsResponse {
  transactions: ApiTxn[];
  /** Keyset cursor for the next page; absent on the last page. Pass back as ?cursor=. */
  nextCursor?: string;
}

/* ---- v2 cross-chain (docs/19): USDC moves between chains; the UI still only ever shows dollars,
   with network names appearing ONLY in the external-send / add-money contexts. ---- */

export interface CrosschainQuoteResponse {
  source: string;
  destination: string;
  amountUsd: string;
  /** fpay's per-destination fee (config). */
  feeUsd: string;
  /** The protocol's own cut (e.g. fast-lane bps), broken out for transparency; UI may combine. */
  railFeeUsd: string;
  totalFeeUsd: string;
  etaSecs: number;
}

export interface PrepareCrosschainRequest {
  network: string; // destination NetworkId
  toAddress: string;
  amountUsd: string | number;
  note?: string;
  idempotencyKey?: string;
}

export interface PrepareCrosschainResponse {
  unsignedTx: string;
  feePayer: string;
  transferId: string;
  feeUsd: string;
  railFeeUsd: string;
  totalFeeUsd: string;
  etaSecs: number;
}

export interface SubmitCrosschainRequest {
  transferId: string;
  signature: string;
}

/** Add money from another wallet (inbound): the user's own EVM deposit address + per-network terms. */
export interface DepositInfoResponse {
  /** The user's own smart-wallet deposit address (same on every listed network); absent until synced. */
  evmAddress?: string;
  options: Array<{ network: string; feeUsd: string; etaSecs: number }>;
}

export interface DepositBalancesResponse {
  /** USDC sitting at the deposit address, per network (UI units/dollars). */
  balances: Record<string, string>;
}

/** Server-built calldata for the sponsored move-to-balance userOp (client stays EVM-lib-free). */
export interface DepositPrepareRequest {
  sourceChain: string;
  /** Total USDC to move off the source chain (our fee is carved out of it server-side). */
  amountUsd: string | number;
}

export interface DepositPrepareResponse {
  chainId: number;
  calls: Array<{ to: string; data: string; value: string }>;
  /** What actually gets bridged after fpay's fee. */
  burnAmountUsd: string;
  feeUsd: string;
  railFeeUsd: string;
  totalFeeUsd: string;
  etaSecs: number;
}

export interface ReportDepositRequest {
  sourceChain: string;
  txHash: string;
  /** Client-asserted, PROVISIONAL — the server reconciles from the attested message. */
  amountUsd: string | number;
}

export interface ReportDepositResponse {
  transferId: string;
  etaSecs: number;
}

export interface ApiPaymentRequest {
  id: string;
  direction: 'incoming' | 'outgoing';
  counterpartyHandle?: string;
  amountUsd: string;
  note?: string;
  status: 'open' | 'paid' | 'cancelled';
  createdAt: string; // ISO 8601
}

export interface RequestsResponse {
  requests: ApiPaymentRequest[];
}

export interface CreateRequestRequest {
  toHandle: string;
  amountUsd: string | number;
  note?: string;
}

export interface PrepareTransferRequest {
  /** In-app recipient by @handle. Exactly one of toHandle / toAddress must be set. */
  toHandle?: string;
  /** External recipient by raw wallet address (v1: Solana only; server re-validates + gates on KYC tier). */
  toAddress?: string;
  amountUsd: string | number;
  note?: string;
  /** Client-generated UUID; the server dedupes prepares on it (double-tap / manual-retry guard). */
  idempotencyKey?: string;
}

export interface PrepareTransferResponse {
  /** Unsigned transaction (base64) the client signs via Privy; gas sponsored by the fee-payer. */
  unsignedTx: string;
  feePayer: string;
  /** Pending transfers row id; echoed back to /transfer/submit to attach the signature. */
  transferId: string;
}

export interface SubmitTransferRequest {
  transferId: string;
  /** Signature of the already-broadcast tx (client signs + sends; backend just records). */
  signature: string;
}

export interface SubmitTransferResponse {
  signature: string;
  status: 'pending' | 'confirmed';
}

/** POST /devnet/faucet — mint controlled test USDC to the caller's wallet (devnet/dev only). */
export interface FaucetRequest {
  amountUsd: string | number;
}

export interface FaucetResponse {
  signature: string;
  balanceUsd: string;
}

/* ---- M1: orders, quotes, the spend/cash-out lifecycle (stablecoin-onofframp-architecture.pdf) ----
 * The real order pipeline that supersedes the MockSettlementProvider stub above: a Quote Engine
 * (rate+fee+ETA, locked 45s) feeding a 7-state Order State Machine settled through backend-custodied
 * devnet escrow with conditional release. Simulated rails (mock merchant/LP, quoted-not-live FX). */

export type OrderDirection = 'spend' | 'cash_out';

/** Plain-English route-quality label surfaced on the quote screen ("complex scoring underneath"). */
export type RouteQuality = 'high' | 'medium' | 'low';

/** Payout rail the merchant/LP settles fiat on. A runtime const (not just a union) so validators
 *  and the backend mirror (apps/backend/src/lib/rails.ts — `import type` rule) can be drift-checked
 *  by check-rails.ts instead of silently disagreeing. */
export const PAYOUT_METHODS = ['UPI', 'QRIS', 'Pix', 'bank'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

/**
 * A locked quote for one order. Symmetric across directions: `amountInr` is the fiat leg and
 * `amountUsdc` the crypto leg debited from the user into escrow. The UI labels them per `direction`
 * ("You pay / From balance" for spend; "You cash out / You receive" for cash_out). Locked 45s —
 * timestamps are epoch ms. (`amountUsdc = amountInr / rate`; there are NO fee fields — the platform's
 * cut is folded into `rate` and never surfaces to the user, only the all-in conversion rate does.)
 */
export interface Quote {
  id: string;
  direction: OrderDirection;
  /** ISO 4217 fiat of the amount/fee legs, derived from the payout rail (INR for UPI, IDR for
   *  QRIS). Field names still say `Inr` from the India-only era — the rename is a separate,
   *  mechanical change; `currency` is what code must branch on. */
  currency: string;
  amountInr: string;
  amountUsdc: string;
  rate: string; // fiat per 1 USDC, after merchant spread + the platform's in-rate cut
  etaMinSecs: number;
  etaMaxSecs: number;
  payoutMethod: PayoutMethod;
  routeQuality: RouteQuality;
  merchantName: string;
  /** The payee's real payout address on the rail (a UPI VPA like 'shop@okhdfcbank'). The merchant
   *  pays THIS; `payoutMethod` only names the rail. Absent on legacy rows quoted before it existed. */
  payoutDestination?: string;
  /** Payee name as printed on the QR — shown pre-pay so the user can catch a wrong-send. */
  payoutName?: string;
  quotedAt: number; // epoch ms
  expiresAt: number; // epoch ms (quotedAt + 45_000)
}

/** Happy-path position of an order (the 7-step timeline) plus the two terminal failures. */
export type OrderState =
  | 'quote_locked'
  | 'pay_instructions'
  | 'waiting_payment'
  | 'payment_detected'
  | 'merchant_confirms'
  | 'funds_released'
  | 'completed'
  | 'refunded'
  | 'failed';

/**
 * Transient overlay shown while an order is mid-flow but something is off (the doc's visible
 * "what's happening" states). `refunded` is the terminal `OrderState`, not an overlay.
 */
export type OrderResolution = 'delayed' | 'needs_action' | 'under_review';

export interface OrderEvent {
  fromState: OrderState | null;
  toState: OrderState;
  event: string;
  detail?: Record<string, unknown>;
  createdAt: string; // ISO 8601
}

export interface Order {
  id: string;
  state: OrderState;
  resolution: OrderResolution | null;
  direction: OrderDirection;
  referenceCode: string;
  amountUsdc: string;
  quote: Quote;
  merchantName: string;
  payoutMethod: PayoutMethod;
  /** Set once a real (human) merchant reports paying the fiat leg. The order stays
   *  `payment_detected` while the dispute window runs; this is what says "the LP claims it paid". */
  payoutClaimedAt?: string; // ISO 8601
  /** The payer's one-tap 👍/👎 after completion; absent = not yet answered. */
  feedbackUp?: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Append-only transition log powering the live timeline (present on GET /orders/:id). */
  events?: OrderEvent[];
}

/* ---- order API DTOs ---- */

export interface QuoteRequest {
  direction: OrderDirection;
  amountInr: string | number;
  payoutMethod?: PayoutMethod;
  /** Where the fiat actually goes (UPI VPA). Server-validated; required for a `spend` quote. */
  payoutDestination?: string;
  payoutName?: string;
}

export interface QuoteResponse {
  quote: Quote;
}

export interface CreateOrderRequest {
  quoteId: string;
}

/** POST /orders — the order plus the unsigned escrow-funding tx (same shape as /transfer/prepare). */
export interface CreateOrderResponse {
  order: Order;
  unsignedTx: string;
  feePayer: string;
  transferId: string;
  referenceCode: string;
}

/** POST /orders/:id/fund-submit — record the broadcast escrow-funding signature. */
export interface FundSubmitRequest {
  transferId: string;
  signature: string;
}

export interface OrderResponse {
  order: Order;
}

export interface OrdersResponse {
  orders: Order[];
  /** Keyset cursor for the next page; absent on the last page. Pass back as ?cursor=. */
  nextCursor?: string;
}

/* ---- admin (read-only flow visibility) DTOs ---- */

/** An order as the operator sees it: cross-user, so the payer's handle rides along. */
export interface AdminOrder extends Order {
  userHandle: string;
}

export interface AdminOrdersResponse {
  orders: AdminOrder[];
  nextCursor?: string;
}

/** Drill-down: the full flow record — timeline events ride on `order.events`. */
export interface AdminOrderDetailResponse {
  order: AdminOrder;
  routingAttempts: Array<{
    sequence: number;
    merchantName: string;
    outcome: 'assigned' | 'released' | 'failed' | 'rerouted';
    reason: string | null;
    createdAt: string; // ISO 8601
  }>;
  dispute: {
    id: string;
    reason: string | null;
    status: 'open' | 'resolved';
    resolution: 'upheld' | 'rejected' | null;
    createdAt: string; // ISO 8601
    resolvedAt: string | null;
  } | null;
  transfers: Array<{
    id: string;
    kind: string;
    status: 'pending' | 'confirmed' | 'failed';
    signature: string | null;
  }>;
}

/** One health read: what's flowing, what's stuck, what needs a human. */
export interface AdminOverviewResponse {
  orderCounts: Partial<Record<OrderState, number>>;
  openDisputes: Array<{ id: string; orderId: string; merchantName: string; amountUsdc: string; createdAt: string }>;
  /** Non-terminal orders carrying a resolution overlay (delayed / needs_action / under_review). */
  stuckOrders: Array<{
    id: string;
    state: OrderState;
    resolution: OrderResolution;
    userHandle: string;
    amountUsdc: string;
    updatedAt: string; // ISO 8601
  }>;
  /** Recent compliance decisions that weren't a plain allow. */
  riskFlags: Array<{
    id: string;
    userHandle: string | null;
    kind: string;
    decision: 'review' | 'block';
    amountUsdc: string | null;
    reason: string | null;
    createdAt: string; // ISO 8601
  }>;
  /** Merchants needing attention: suspended, or KYB still pending. */
  merchantAlerts: Array<{ id: string; name: string; status: string; kybStatus: string }>;
  failedBridgeCount: number;
}

/* ---- admin ops (fpay-admin console) DTOs ---- */
/* (WaitlistJoinRequest lives with the public request DTOs above — /waitlist is unauthenticated.) */

export interface AdminWaitlistEntry {
  email: string;
  city: string | null;
  createdAt: string; // ISO 8601
  /** This member's own share code (null on rows predating the referral loop). */
  code: string | null;
  /** '@handle' or another member's ref code. Null = came in cold. */
  referredBy: string | null;
  /** When they clicked the confirm link. Null = unverified. */
  verifiedAt: string | null; // ISO 8601
}

export interface AdminWaitlistResponse {
  entries: AdminWaitlistEntry[];
}

export interface AdminUser {
  id: string;
  handle: string;
  displayName: string | null;
  email: string | null;
  kycTier: number;
  kycStatus: string;
  role: 'user' | 'merchant' | 'admin';
  /** 'suspended' 403s every authed request and hides the handle from resolution. */
  status: 'active' | 'suspended' | 'deleted';
  createdAt: string; // ISO 8601
}

export interface AdminUsersResponse {
  users: AdminUser[];
  nextCursor?: string;
}

export interface AdminMerchant {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'suspended';
  kybStatus: 'pending' | 'approved' | 'rejected';
  payoutRail: string;
  bondUsdc: string;
  floatUsdc: string;
  successRate: number;
  disputeRate: number;
  positiveRate: number;
  /** true = a real logged-in merchant (merchants.user_id set), false = seeded sim LP. */
  real: boolean;
}

export interface AdminMerchantsResponse {
  merchants: AdminMerchant[];
}

export interface AdminRiskEvent {
  id: string;
  userHandle: string | null;
  kind: string;
  decision: 'allow' | 'review' | 'block';
  score: number;
  amountUsdc: string | null;
  reason: string | null;
  counterparty: string | null;
  createdAt: string; // ISO 8601
}

export interface AdminRiskEventsResponse {
  events: AdminRiskEvent[];
  nextCursor?: string;
}

/** One payout-provider registry row (docs/23) — routing metadata only; credentials live in server
 *  env and never cross this wire. */
export interface AdminPayoutProvider {
  id: string;
  adapter: string;
  /** A PayoutMethod, or '*' (serves every rail). */
  payoutMethod: string;
  priority: number;
  enabled: boolean;
  /** Whether the server resolves a usable credential for this row — presence only, never values.
   *  enabled && !hasCredentials = an inert row the console should flag. */
  hasCredentials: boolean;
}

export interface AdminPayoutProvidersResponse {
  providers: AdminPayoutProvider[];
}

export interface AdminDenylistEntry {
  id: string;
  kind: 'address' | 'handle';
  value: string;
  reason: string | null;
  createdAt: string; // ISO 8601
}

export interface AdminDenylistResponse {
  entries: AdminDenylistEntry[];
}

/** One invite code, as the console sees it. Unlike the user-facing view, `code` is always present:
 *  the string is stored in plain text precisely so an operator can read it back. */
export interface AdminInviteCode {
  code: string;
  /** Whose invite it is. Null = a house code minted from the console, belonging to nobody. */
  ownerHandle: string | null;
  /** Derived, not stored: revoked beats redeemed if somehow both are set. */
  status: 'unused' | 'burned' | 'revoked';
  /** Who signed up on it. Null unless status is 'burned'. */
  redeemedByHandle: string | null;
  redeemedAt: string | null; // ISO 8601
  revokedAt: string | null; // ISO 8601
  /** Free-text operator note, set when minting. */
  note: string | null;
  createdAt: string; // ISO 8601
}

export interface AdminInvitesResponse {
  invites: AdminInviteCode[];
  nextCursor?: string;
}

/** One audit row: which admin did what to which target. */
export interface AdminAction {
  id: string;
  adminHandle: string;
  action: string;
  targetKind: string;
  targetId: string;
  note: string | null;
  createdAt: string; // ISO 8601
}

export interface AdminActionsResponse {
  actions: AdminAction[];
  nextCursor?: string;
}

/* admin write requests */
export interface AdminKybRequest {
  decision: 'approve' | 'reject';
}

export interface AdminMerchantStatusRequest {
  status: 'online' | 'offline' | 'suspended';
}

export interface AdminDisputeResolveRequest {
  resolution: 'upheld' | 'rejected';
  note?: string;
}

export interface AdminDenylistAddRequest {
  kind: 'address' | 'handle';
  value: string;
  reason?: string;
}

/** Mint invite codes from the console — the only unbounded source of them. Omit `ownerHandle` for
 *  house codes (owner_id null): they belong to nobody, so nobody's allowance constrains them, which
 *  is what makes this the answer to "we've run out of invites". */
export interface AdminInviteMintRequest {
  count: number;
  ownerHandle?: string;
  note?: string;
}

/** Promote/demote an operator. 'merchant' is deliberately absent — that role is earned by applying,
 *  not granted, and this endpoint must never be able to strip it. */
export interface AdminUserRoleRequest {
  role: 'user' | 'admin';
}

/** Support-desk profile edit (docs/24). Renaming frees the old handle INSTANTLY — anyone can claim
 *  it and saved QR codes follow the claimant. At least one of handle/displayName required. */
export interface AdminUserPatchRequest {
  handle?: string;
  displayName?: string;
  reason?: string;
}

/** Suspend/reinstate an account. Reason is mandatory both ways — identity actions on a money
 *  account carry a WHY on the audit record, not just a who/when. */
export interface AdminUserStatusRequest {
  status: 'active' | 'suspended' | 'deleted';
  reason: string;
}

/** The SUBTRACT-only surface (docs/23 invariant 11): enable/disable + reorder. Rows are created by
 *  seed/SQL and adapters by deploys — there is deliberately no create or delete request. */
export interface AdminPayoutProviderUpdateRequest {
  enabled?: boolean;
  priority?: number;
}
