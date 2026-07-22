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

export interface Merchant {
  name: string;
}

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
}

export interface BalanceResponse {
  balanceUsd: number;
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
  amountUsd: number; // unsigned magnitude
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

export interface ApiPaymentRequest {
  id: string;
  direction: 'incoming' | 'outgoing';
  counterpartyHandle?: string;
  amountUsd: number;
  note?: string;
  status: 'open' | 'paid' | 'cancelled';
  createdAt: string; // ISO 8601
}

export interface RequestsResponse {
  requests: ApiPaymentRequest[];
}

export interface CreateRequestRequest {
  toHandle: string;
  amountUsd: number;
  note?: string;
}

export interface PrepareTransferRequest {
  /** In-app recipient by @handle. Exactly one of toHandle / toAddress must be set. */
  toHandle?: string;
  /** External recipient by raw wallet address (v1: Solana only; server re-validates + gates on KYC tier). */
  toAddress?: string;
  amountUsd: number;
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
  amountUsd: number;
}

export interface FaucetResponse {
  signature: string;
  balanceUsd: number;
}

/* ---- M1: orders, quotes, the spend/cash-out lifecycle (stablecoin-onofframp-architecture.pdf) ----
 * The real order pipeline that supersedes the MockSettlementProvider stub above: a Quote Engine
 * (rate+fee+ETA, locked 45s) feeding a 7-state Order State Machine settled through backend-custodied
 * devnet escrow with conditional release. Simulated rails (mock merchant/LP, quoted-not-live FX). */

export type OrderDirection = 'spend' | 'cash_out';

/** Plain-English route-quality label surfaced on the quote screen ("complex scoring underneath"). */
export type RouteQuality = 'high' | 'medium' | 'low';

/** Payout rail the merchant/LP settles fiat on. */
export type PayoutMethod = 'UPI' | 'Pix' | 'bank';

/**
 * A locked quote for one order. Symmetric across directions: `amountInr` is the fiat leg and
 * `amountUsdc` the crypto leg debited from the user into escrow. The UI labels them per `direction`
 * ("You pay / From balance" for spend; "You cash out / You receive" for cash_out). Locked 45s —
 * timestamps are epoch ms. (`amountUsdc = amountInr / rate`; fees are itemized line items reflecting
 * the merchant spread for M1, mirroring the doc's quote screen math.)
 */
export interface Quote {
  id: string;
  direction: OrderDirection;
  amountInr: number;
  amountUsdc: number;
  rate: number; // INR per 1 USDC, after merchant spread
  feeInr: number;
  networkFeeInr: number;
  etaMinSecs: number;
  etaMaxSecs: number;
  payoutMethod: PayoutMethod;
  routeQuality: RouteQuality;
  merchantName: string;
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
  amountUsdc: number;
  quote: Quote;
  merchantName: string;
  payoutMethod: PayoutMethod;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Append-only transition log powering the live timeline (present on GET /orders/:id). */
  events?: OrderEvent[];
}

/* ---- order API DTOs ---- */

export interface QuoteRequest {
  direction: OrderDirection;
  amountInr: number;
  payoutMethod?: PayoutMethod;
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
