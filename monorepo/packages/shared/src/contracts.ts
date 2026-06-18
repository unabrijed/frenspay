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
