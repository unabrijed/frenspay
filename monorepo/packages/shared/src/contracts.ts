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
  transfer(input: { toHandle: string; amountUsd: number; note?: string }): Promise<Txn>;
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
}

/** 403 body when a money-movement action exceeds the user's KYC-tier limit (M5). */
export interface LimitExceededError {
  error: 'limit_exceeded';
  kind: 'send' | 'cash_out';
  currentTier: number;
  requiredTier: number;
  limitUsd: number;
  reason: string;
}

/** POST /auth/sync body — token in the Authorization header identifies the Privy user. */
export interface AuthSyncRequest {
  handle: string;
  walletAddress: string;
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
  note?: string;
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: string; // ISO 8601
  signature?: string;
}

export interface TransactionsResponse {
  transactions: ApiTxn[];
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
  toHandle: string;
  amountUsd: number;
  note?: string;
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
}
