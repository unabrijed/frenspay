// queries.ts — typed data access over the lazy pg pool (db/pool.ts).
// Maps rows to the @pay/shared wire DTOs. Phase 1 is USDC-only, so no rupee column.
import type {
  ApiPaymentRequest,
  ApiTxn,
  Friend,
  Notification,
  Order,
  OrderDirection,
  OrderEvent,
  OrderResolution,
  OrderState,
  PayoutMethod,
  Quote,
  RouteQuality,
} from '@pay/shared';

import { getPool } from './pool';

export type TransferKind = 'send' | 'add' | 'pay' | 'escrow_fund' | 'escrow_release';

export interface UserRow {
  id: string;
  privy_did: string;
  handle: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface WalletRow {
  id: string;
  user_id: string;
  chain: string;
  address: string;
}

const initial = (s: string): string => {
  const c = s.replace(/^@/, '').trim().charAt(0);
  return (c || '?').toUpperCase();
};

const toFriend = (u: { handle: string; display_name: string | null }): Friend => ({
  name: u.display_name ?? u.handle,
  handle: u.handle,
  ini: initial(u.display_name ?? u.handle),
});

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>('select * from users where id = $1', [id]);
  return rows[0] ?? null;
}

export async function findUserByHandle(handle: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>('select * from users where handle = $1', [handle]);
  return rows[0] ?? null;
}

export async function findUserByPrivyDid(did: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>('select * from users where privy_did = $1', [did]);
  return rows[0] ?? null;
}

/**
 * Upsert the user (by Privy DID) + their wallet. Called by /auth/sync after login.
 * Atomic: user + wallet land together or not at all, so a wallet-insert failure can't
 * leave a walletless user. A handle collision raises PG 23505 (caller maps it to 409).
 */
export async function upsertUserByPrivyDid(input: {
  privyDid: string;
  handle: string;
  displayName?: string;
  walletAddress: string;
}): Promise<UserRow> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<UserRow>(
      `insert into users (privy_did, handle, display_name)
       values ($1, $2, $3)
       on conflict (privy_did) do update set handle = excluded.handle, display_name = excluded.display_name
       returning *`,
      [input.privyDid, input.handle, input.displayName ?? null],
    );
    const user = rows[0];
    await client.query(
      `insert into wallets (user_id, address) values ($1, $2)
       on conflict (address) do nothing`,
      [user.id, input.walletAddress],
    );
    await client.query('commit');
    return user;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export async function getWalletForUser(userId: string): Promise<WalletRow | null> {
  const { rows } = await getPool().query<WalletRow>(
    'select * from wallets where user_id = $1 order by created_at asc limit 1',
    [userId],
  );
  return rows[0] ?? null;
}

export async function resolveHandleToFriend(handle: string): Promise<Friend | null> {
  const { rows } = await getPool().query<{ handle: string; display_name: string | null }>(
    'select handle, display_name from users where handle = $1',
    [handle],
  );
  return rows[0] ? toFriend(rows[0]) : null;
}

interface TransferJoinRow {
  id: string;
  kind: ApiTxn['kind'];
  amount_usdc: string; // pg numeric → string
  note: string | null;
  status: string;
  created_at: Date;
  signature: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  from_handle: string | null;
  to_handle: string | null;
}

export async function listTransactionsForUser(userId: string, limit = 100): Promise<ApiTxn[]> {
  const { rows } = await getPool().query<TransferJoinRow>(
    `select t.id, t.kind, t.amount_usdc, t.note, t.status, t.created_at, t.signature,
            t.from_user_id, t.to_user_id,
            fu.handle as from_handle, tu.handle as to_handle
       from transfers t
       left join users fu on fu.id = t.from_user_id
       left join users tu on tu.id = t.to_user_id
      where t.from_user_id = $1 or t.to_user_id = $1
      order by t.created_at desc
      limit $2`,
    [userId, limit],
  );

  return rows.map((r): ApiTxn => {
    const direction: 'in' | 'out' = r.from_user_id === userId ? 'out' : 'in';
    const counterpartyHandle = (direction === 'out' ? r.to_handle : r.from_handle) ?? undefined;
    return {
      id: r.id,
      kind: r.kind,
      direction,
      amountUsd: Number(r.amount_usdc),
      counterpartyHandle,
      note: r.note ?? undefined,
      status: r.status as ApiTxn['status'],
      createdAt: r.created_at.toISOString(),
      signature: r.signature ?? undefined,
    };
  });
}

interface RequestJoinRow {
  id: string;
  from_user_id: string;
  to_user_id: string | null;
  amount_usdc: string;
  note: string | null;
  status: string;
  created_at: Date;
  from_handle: string | null;
  to_handle: string | null;
}

export async function listRequestsForUser(userId: string): Promise<ApiPaymentRequest[]> {
  const { rows } = await getPool().query<RequestJoinRow>(
    `select r.id, r.from_user_id, r.to_user_id, r.amount_usdc, r.note, r.status, r.created_at,
            fu.handle as from_handle, tu.handle as to_handle
       from payment_requests r
       left join users fu on fu.id = r.from_user_id
       left join users tu on tu.id = r.to_user_id
      where r.from_user_id = $1 or r.to_user_id = $1
      order by r.created_at desc`,
    [userId],
  );

  return rows.map((r): ApiPaymentRequest => {
    const direction: 'incoming' | 'outgoing' = r.to_user_id === userId ? 'incoming' : 'outgoing';
    const counterpartyHandle = (direction === 'incoming' ? r.from_handle : r.to_handle) ?? undefined;
    return {
      id: r.id,
      direction,
      counterpartyHandle,
      amountUsd: Number(r.amount_usdc),
      note: r.note ?? undefined,
      status: r.status as ApiPaymentRequest['status'],
      createdAt: r.created_at.toISOString(),
    };
  });
}

export async function createRequest(input: {
  fromUserId: string;
  toUserId: string | null;
  amountUsd: number;
  note?: string;
}): Promise<ApiPaymentRequest> {
  const { rows } = await getPool().query<RequestJoinRow>(
    `with inserted as (
       insert into payment_requests (from_user_id, to_user_id, amount_usdc, note)
       values ($1, $2, $3, $4)
       returning *
     )
     select i.id, i.from_user_id, i.to_user_id, i.amount_usdc, i.note, i.status, i.created_at,
            fu.handle as from_handle, tu.handle as to_handle
       from inserted i
       left join users fu on fu.id = i.from_user_id
       left join users tu on tu.id = i.to_user_id`,
    [input.fromUserId, input.toUserId, input.amountUsd, input.note ?? null],
  );
  const r = rows[0];
  return {
    id: r.id,
    direction: 'outgoing',
    counterpartyHandle: r.to_handle ?? undefined,
    amountUsd: Number(r.amount_usdc),
    note: r.note ?? undefined,
    status: r.status as ApiPaymentRequest['status'],
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * Resolve an open request as paid, linking the fulfilling transfer. Scoped to the payer
 * (to_user_id) and to status='open' so only the addressee can pay, and only once.
 * Returns false when no open row matched.
 */
export async function markRequestPaid(
  requestId: string,
  payerUserId: string,
  transferId: string,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update payment_requests
        set status = 'paid', transfer_id = $3
      where id = $1 and to_user_id = $2 and status = 'open'`,
    [requestId, payerUserId, transferId],
  );
  return (rowCount ?? 0) > 0;
}

/** Cancel an open request. Scoped to the requester (from_user_id). Returns false if no open row matched. */
export async function cancelRequest(requestId: string, requesterUserId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update payment_requests
        set status = 'cancelled'
      where id = $1 and from_user_id = $2 and status = 'open'`,
    [requestId, requesterUserId],
  );
  return (rowCount ?? 0) > 0;
}

/* ---- transfers (M1 prepare/submit, M2 confirmation) ---- */

export async function createPendingTransfer(input: {
  fromUserId: string | null;
  toUserId: string | null;
  fromAddress: string;
  toAddress: string;
  amountUsd: number;
  kind?: TransferKind;
  note?: string;
}): Promise<{ id: string }> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into transfers (from_user_id, to_user_id, from_address, to_address, amount_usdc, kind, note, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'pending')
     returning id`,
    [
      input.fromUserId,
      input.toUserId,
      input.fromAddress,
      input.toAddress,
      input.amountUsd,
      input.kind ?? 'send',
      input.note ?? null,
    ],
  );
  return rows[0];
}

/**
 * Record a devnet faucet deposit as a confirmed incoming 'add' transfer so it shows in activity.
 * (from_user_id null = external/faucet origin → listTransactionsForUser renders it as direction 'in'.)
 */
export async function recordDeposit(input: {
  toUserId: string;
  toAddress: string;
  amountUsd: number;
  signature: string;
}): Promise<{ id: string }> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into transfers (to_user_id, to_address, amount_usdc, kind, status, signature, confirmed_at)
     values ($1, $2, $3, 'add', 'confirmed', $4, now())
     returning id`,
    [input.toUserId, input.toAddress, input.amountUsd, input.signature],
  );
  return rows[0];
}

/**
 * Record the broadcast signature on a transfer the caller owns. Scoped to from_user_id so a
 * user can only attach a signature to their own transfer. Returns false when no row matched
 * (unknown id or not the owner) so the route can 404 instead of silently no-op'ing.
 */
export async function attachTransferSignature(
  transferId: string,
  signature: string,
  ownerUserId: string,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'update transfers set signature = $2 where id = $1 and from_user_id = $3',
    [transferId, signature, ownerUserId],
  );
  return (rowCount ?? 0) > 0;
}

export async function setTransferStatus(
  transferId: string,
  status: 'pending' | 'confirmed' | 'failed',
): Promise<void> {
  await getPool().query(
    `update transfers
        set status = $2,
            confirmed_at = case when $2 = 'confirmed' then now() else confirmed_at end
      where id = $1`,
    [transferId, status],
  );
}

export async function setTransferStatusBySignature(
  signature: string,
  status: 'pending' | 'confirmed' | 'failed',
): Promise<void> {
  await getPool().query(
    `update transfers
        set status = $2,
            confirmed_at = case when $2 = 'confirmed' then now() else confirmed_at end
      where signature = $1`,
    [signature, status],
  );
}

export async function getPendingSignatures(): Promise<{ id: string; signature: string }[]> {
  const { rows } = await getPool().query<{ id: string; signature: string }>(
    `select id, signature from transfers where status = 'pending' and signature is not null`,
  );
  return rows;
}

/**
 * Retire transfers abandoned after /transfer/prepare: still pending, never signed, older than
 * maxAgeMin. The confirmer poller only follows signed rows (getPendingSignatures), so without
 * this sweep these would stay pending forever. Returns how many were expired.
 */
export async function expireStaleUnsignedTransfers(maxAgeMin = 15): Promise<number> {
  const { rowCount } = await getPool().query(
    `update transfers
        set status = 'failed'
      where status = 'pending' and signature is null
        and created_at < now() - make_interval(mins => $1)`,
    [maxAgeMin],
  );
  return rowCount ?? 0;
}

/**
 * Record an already-broadcast backend-signed transfer (escrow release/refund) as pending+signed
 * so the confirmer poller follows it to a terminal status, exactly like a user transfer.
 */
export async function recordEscrowTransfer(input: {
  fromAddress: string;
  toAddress: string;
  toUserId?: string | null;
  amountUsd: number;
  kind: 'escrow_release';
  signature: string;
  note?: string;
}): Promise<{ id: string }> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into transfers (from_address, to_address, to_user_id, amount_usdc, kind, status, signature, note)
     values ($1, $2, $3, $4, $5, 'pending', $6, $7)
     returning id`,
    [
      input.fromAddress,
      input.toAddress,
      input.toUserId ?? null,
      input.amountUsd,
      input.kind,
      input.signature,
      input.note ?? null,
    ],
  );
  return rows[0];
}

/* ---- M1: merchants / quotes / orders (stablecoin on/off-ramp lifecycle) ---- */

export interface MerchantRow {
  id: string;
  name: string;
  payout_rail: PayoutMethod;
  status: 'online' | 'offline' | 'suspended';
  treasury_address: string;
  success_rate: string;
  avg_completion_secs: number;
  spread_bps: number;
  float_usdc: string;
  dispute_rate: string;
  kyb_status: 'pending' | 'approved' | 'rejected';
  bond_usdc: string;
  base_success_rate: string;
  base_avg_completion_secs: number;
  base_dispute_rate: string;
  sim_behavior: 'happy' | 'slow' | 'no_receipt' | 'timeout';
}

/** Merchants eligible for routing: online AND KYB-approved (M4). */
export async function listRoutableMerchants(): Promise<MerchantRow[]> {
  const { rows } = await getPool().query<MerchantRow>(
    `select * from merchants where status = 'online' and kyb_status = 'approved'`,
  );
  return rows;
}

/** Every merchant (incl. suspended/pending) — for the M4 stats recompute pass. */
export async function listAllMerchants(): Promise<MerchantRow[]> {
  const { rows } = await getPool().query<MerchantRow>(`select * from merchants`);
  return rows;
}

interface QuoteRow {
  id: string;
  user_id: string;
  merchant_id: string | null;
  direction: OrderDirection;
  amount_inr: string;
  amount_usdc: string;
  rate: string;
  fee_inr: string;
  network_fee_inr: string;
  eta_min_secs: number;
  eta_max_secs: number;
  payout_method: PayoutMethod;
  route_quality: RouteQuality;
  created_at: Date;
  expires_at: Date;
  merchant_name: string | null;
}

function toQuote(r: QuoteRow): Quote {
  return {
    id: r.id,
    direction: r.direction,
    amountInr: Number(r.amount_inr),
    amountUsdc: Number(r.amount_usdc),
    rate: Number(r.rate),
    feeInr: Number(r.fee_inr),
    networkFeeInr: Number(r.network_fee_inr),
    etaMinSecs: r.eta_min_secs,
    etaMaxSecs: r.eta_max_secs,
    payoutMethod: r.payout_method,
    routeQuality: r.route_quality,
    merchantName: r.merchant_name ?? 'Best route',
    quotedAt: r.created_at.getTime(),
    expiresAt: r.expires_at.getTime(),
  };
}

export async function insertQuote(input: {
  userId: string;
  merchantId: string | null;
  direction: OrderDirection;
  amountInr: number;
  amountUsdc: number;
  rate: number;
  feeInr: number;
  networkFeeInr: number;
  etaMinSecs: number;
  etaMaxSecs: number;
  payoutMethod: PayoutMethod;
  routeQuality: RouteQuality;
  expiresAt: Date;
}): Promise<Quote> {
  const { rows } = await getPool().query<QuoteRow>(
    `with ins as (
       insert into quotes (user_id, merchant_id, direction, amount_inr, amount_usdc, rate,
                           fee_inr, network_fee_inr, eta_min_secs, eta_max_secs,
                           payout_method, route_quality, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning *
     )
     select ins.*, m.name as merchant_name
       from ins left join merchants m on m.id = ins.merchant_id`,
    [
      input.userId,
      input.merchantId,
      input.direction,
      input.amountInr,
      input.amountUsdc,
      input.rate,
      input.feeInr,
      input.networkFeeInr,
      input.etaMinSecs,
      input.etaMaxSecs,
      input.payoutMethod,
      input.routeQuality,
      input.expiresAt,
    ],
  );
  return toQuote(rows[0]);
}

/** Raw quote row scoped to its owner — used at order-confirm time to re-check expiry. */
export async function getQuoteRowForUser(
  quoteId: string,
  userId: string,
): Promise<{ id: string; merchantId: string | null; amountUsdc: number; expiresAt: Date } | null> {
  const { rows } = await getPool().query<{
    id: string;
    merchant_id: string | null;
    amount_usdc: string;
    expires_at: Date;
  }>('select id, merchant_id, amount_usdc, expires_at from quotes where id = $1 and user_id = $2', [
    quoteId,
    userId,
  ]);
  const r = rows[0];
  return r
    ? { id: r.id, merchantId: r.merchant_id, amountUsdc: Number(r.amount_usdc), expiresAt: r.expires_at }
    : null;
}

interface OrderJoinRow {
  id: string;
  user_id: string;
  state: OrderState;
  resolution: OrderResolution | null;
  amount_usdc: string;
  reference_code: string;
  created_at: Date;
  updated_at: Date;
  quote_id: string;
  // joined quote columns (aliased)
  q_direction: OrderDirection;
  q_amount_inr: string;
  q_amount_usdc: string;
  q_rate: string;
  q_fee_inr: string;
  q_network_fee_inr: string;
  q_eta_min_secs: number;
  q_eta_max_secs: number;
  q_payout_method: PayoutMethod;
  q_route_quality: RouteQuality;
  q_created_at: Date;
  q_expires_at: Date;
  merchant_name: string | null;
}

const ORDER_SELECT = `
  select o.id, o.user_id, o.state, o.resolution, o.amount_usdc, o.reference_code,
         o.created_at, o.updated_at, o.quote_id,
         q.direction as q_direction, q.amount_inr as q_amount_inr, q.amount_usdc as q_amount_usdc,
         q.rate as q_rate, q.fee_inr as q_fee_inr, q.network_fee_inr as q_network_fee_inr,
         q.eta_min_secs as q_eta_min_secs, q.eta_max_secs as q_eta_max_secs,
         q.payout_method as q_payout_method, q.route_quality as q_route_quality,
         q.created_at as q_created_at, q.expires_at as q_expires_at,
         m.name as merchant_name
    from orders o
    join quotes q on q.id = o.quote_id
    left join merchants m on m.id = o.merchant_id`;

function toOrder(r: OrderJoinRow, events?: OrderEvent[]): Order {
  const quote: Quote = {
    id: r.quote_id,
    direction: r.q_direction,
    amountInr: Number(r.q_amount_inr),
    amountUsdc: Number(r.q_amount_usdc),
    rate: Number(r.q_rate),
    feeInr: Number(r.q_fee_inr),
    networkFeeInr: Number(r.q_network_fee_inr),
    etaMinSecs: r.q_eta_min_secs,
    etaMaxSecs: r.q_eta_max_secs,
    payoutMethod: r.q_payout_method,
    routeQuality: r.q_route_quality,
    merchantName: r.merchant_name ?? 'Best route',
    quotedAt: r.q_created_at.getTime(),
    expiresAt: r.q_expires_at.getTime(),
  };
  return {
    id: r.id,
    state: r.state,
    resolution: r.resolution,
    direction: r.q_direction,
    referenceCode: r.reference_code,
    amountUsdc: Number(r.amount_usdc),
    quote,
    merchantName: quote.merchantName,
    payoutMethod: r.q_payout_method,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    events,
  };
}

export async function insertOrder(input: {
  userId: string;
  quoteId: string;
  merchantId: string | null;
  amountUsdc: number;
  referenceCode: string;
  state: OrderState;
  escrowFundTransferId: string | null;
  note?: string;
}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state, escrow_fund_transfer_id, note)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning id`,
    [
      input.userId,
      input.quoteId,
      input.merchantId,
      input.amountUsdc,
      input.referenceCode,
      input.state,
      input.escrowFundTransferId,
      input.note ?? null,
    ],
  );
  return rows[0].id;
}

export async function appendOrderEvent(
  orderId: string,
  fromState: OrderState | null,
  toState: OrderState,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await getPool().query(
    `insert into order_events (order_id, from_state, to_state, event, detail)
     values ($1,$2,$3,$4,$5)`,
    [orderId, fromState, toState, event, detail ? JSON.stringify(detail) : null],
  );
}

export async function listOrderEvents(orderId: string): Promise<OrderEvent[]> {
  const { rows } = await getPool().query<{
    from_state: OrderState | null;
    to_state: OrderState;
    event: string;
    detail: Record<string, unknown> | null;
    created_at: Date;
  }>(
    `select from_state, to_state, event, detail, created_at
       from order_events where order_id = $1 order by created_at asc`,
    [orderId],
  );
  return rows.map((r) => ({
    fromState: r.from_state,
    toState: r.to_state,
    event: r.event,
    detail: r.detail ?? undefined,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function getOrderForUser(orderId: string, userId: string): Promise<Order | null> {
  const { rows } = await getPool().query<OrderJoinRow>(`${ORDER_SELECT} where o.id = $1 and o.user_id = $2`, [
    orderId,
    userId,
  ]);
  if (!rows[0]) return null;
  const events = await listOrderEvents(orderId);
  return toOrder(rows[0], events);
}

export async function listOrdersForUser(userId: string, limit = 50): Promise<Order[]> {
  const { rows } = await getPool().query<OrderJoinRow>(
    `${ORDER_SELECT} where o.user_id = $1 order by o.created_at desc limit $2`,
    [userId, limit],
  );
  return rows.map((r) => toOrder(r));
}

/** State patch with bumped updated_at. Pass only the fields to change; `clearResolution` nulls it. */
export async function updateOrder(
  orderId: string,
  patch: {
    state?: OrderState;
    resolution?: OrderResolution | null;
    expiresAt?: Date | null;
    escrowReleaseTransferId?: string;
  },
): Promise<void> {
  const sets: string[] = ['updated_at = now()'];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.state !== undefined) {
    sets.push(`state = $${++i}`);
    vals.push(patch.state);
  }
  if (patch.resolution !== undefined) {
    sets.push(`resolution = $${++i}`);
    vals.push(patch.resolution);
  }
  if (patch.expiresAt !== undefined) {
    sets.push(`expires_at = $${++i}`);
    vals.push(patch.expiresAt);
  }
  if (patch.escrowReleaseTransferId !== undefined) {
    sets.push(`escrow_release_transfer_id = $${++i}`);
    vals.push(patch.escrowReleaseTransferId);
  }
  await getPool().query(`update orders set ${sets.join(', ')} where id = $1`, [orderId, ...vals]);
}

/** Lightweight order row for the worker including the merchant's sim fields + the quote's rail. */
export interface WorkerOrderRow {
  id: string;
  user_id: string;
  reference_code: string;
  state: OrderState;
  resolution: OrderResolution | null;
  amount_usdc: string;
  updated_at: Date;
  expires_at: Date | null;
  escrow_release_transfer_id: string | null;
  merchant_id: string | null;
  treasury_address: string | null;
  sim_behavior: 'happy' | 'slow' | 'no_receipt' | 'timeout' | null;
  payout_method: PayoutMethod | null;
}

/** Orders the simulated-merchant worker drives (mid-flow, awaiting the LP). */
export async function listWorkerOrders(): Promise<WorkerOrderRow[]> {
  const { rows } = await getPool().query<WorkerOrderRow>(
    `select o.id, o.user_id, o.reference_code, o.state, o.resolution, o.amount_usdc, o.updated_at,
            o.expires_at, o.escrow_release_transfer_id, o.merchant_id,
            m.treasury_address, m.sim_behavior, q.payout_method
       from orders o
       left join merchants m on m.id = o.merchant_id
       join quotes q on q.id = o.quote_id
      where o.state in ('payment_detected','merchant_confirms')`,
  );
  return rows;
}

export async function getOrderByEscrowFundTransfer(transferId: string): Promise<{ id: string; state: OrderState } | null> {
  const { rows } = await getPool().query<{ id: string; state: OrderState }>(
    'select id, state from orders where escrow_fund_transfer_id = $1',
    [transferId],
  );
  return rows[0] ?? null;
}

export async function getOrderByEscrowReleaseTransfer(transferId: string): Promise<{ id: string; state: OrderState } | null> {
  const { rows } = await getPool().query<{ id: string; state: OrderState }>(
    'select id, state from orders where escrow_release_transfer_id = $1',
    [transferId],
  );
  return rows[0] ?? null;
}

export async function getOrderEscrowFundTransferId(orderId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ escrow_fund_transfer_id: string | null }>(
    'select escrow_fund_transfer_id from orders where id = $1',
    [orderId],
  );
  return rows[0]?.escrow_fund_transfer_id ?? null;
}

/** Core order fields for the dev-only /sim endpoints (no quote join). */
export async function getOrderSimRow(
  orderId: string,
): Promise<{
  id: string;
  userId: string;
  reference: string;
  amountUsdc: number;
  state: OrderState;
  treasuryAddress: string | null;
} | null> {
  const { rows } = await getPool().query<{
    id: string;
    user_id: string;
    reference_code: string;
    amount_usdc: string;
    state: OrderState;
    treasury_address: string | null;
  }>(
    `select o.id, o.user_id, o.reference_code, o.amount_usdc, o.state, m.treasury_address
       from orders o left join merchants m on m.id = o.merchant_id
      where o.id = $1`,
    [orderId],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        userId: r.user_id,
        reference: r.reference_code,
        amountUsdc: Number(r.amount_usdc),
        state: r.state,
        treasuryAddress: r.treasury_address,
      }
    : null;
}

/**
 * Atomic compare-and-set on order state — claims a transition only if the order is still in one of
 * `fromStates`. Returns true if it moved. Lets the worker and the dev /sim endpoints race safely
 * (only one wins the claim before broadcasting an escrow tx).
 */
export async function casOrderState(
  orderId: string,
  fromStates: OrderState[],
  toState: OrderState,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update orders set state = $3, updated_at = now()
      where id = $1 and state = any($2::text[])`,
    [orderId, fromStates, toState],
  );
  return (rowCount ?? 0) > 0;
}

/** Cancel an order whose escrow funding never completed (signing failed/abandoned). Owner-scoped. */
export async function cancelOrder(orderId: string, userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update orders set state = 'failed', updated_at = now()
      where id = $1 and user_id = $2 and state in ('pay_instructions','waiting_payment')`,
    [orderId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Retire orders stuck pre-escrow (prepared but never funded) past maxAgeMin — mirrors
 * expireStaleUnsignedTransfers so abandoned orders don't linger in pay_instructions forever.
 */
export async function expireStaleOrders(maxAgeMin = 15): Promise<number> {
  const { rowCount } = await getPool().query(
    `update orders set state = 'failed', updated_at = now()
      where state in ('pay_instructions','waiting_payment')
        and created_at < now() - make_interval(mins => $1)`,
    [maxAgeMin],
  );
  return rowCount ?? 0;
}

/* ---- M3: routing signals + reroute audit ---- */

/** Record a routing assignment / reroute for an order (the audit log + tried-set). */
export async function insertRoutingAttempt(input: {
  orderId: string;
  merchantId: string;
  sequence: number;
  outcome?: 'assigned' | 'released' | 'failed' | 'rerouted';
  reason?: string;
}): Promise<void> {
  await getPool().query(
    `insert into order_routing_attempts (order_id, merchant_id, sequence, outcome, reason)
     values ($1,$2,$3,$4,$5)
     on conflict (order_id, sequence) do nothing`,
    [input.orderId, input.merchantId, input.sequence, input.outcome ?? 'assigned', input.reason ?? null],
  );
}

/** Mark the latest (highest-sequence) attempt for an order with a terminal outcome. */
export async function markLatestAttemptOutcome(
  orderId: string,
  outcome: 'released' | 'failed' | 'rerouted',
): Promise<void> {
  await getPool().query(
    `update order_routing_attempts set outcome = $2
      where order_id = $1
        and sequence = (select max(sequence) from order_routing_attempts where order_id = $1)`,
    [orderId, outcome],
  );
}

/** The merchants already tried for an order + the current attempt count (drives failover). */
export async function listRoutingAttempts(
  orderId: string,
): Promise<{ merchantId: string; sequence: number; outcome: string }[]> {
  const { rows } = await getPool().query<{ merchant_id: string; sequence: number; outcome: string }>(
    `select merchant_id, sequence, outcome from order_routing_attempts
      where order_id = $1 order by sequence asc`,
    [orderId],
  );
  return rows.map((r) => ({ merchantId: r.merchant_id, sequence: r.sequence, outcome: r.outcome }));
}

/**
 * Atomically reassign a stalled order to a new merchant for auto-failover: only fires while the order
 * is still in payment_detected, clears the resolution, and resets the SLA deadline. Returns true if it
 * claimed the reassignment (false = someone else already moved it).
 */
export async function reassignOrderMerchant(
  orderId: string,
  merchantId: string,
  expiresAt: Date,
  expectedMerchantId: string,
): Promise<boolean> {
  // Exclusive claim: only the reroute that still sees the *stalled* merchant wins, so two concurrent
  // worker ticks can't both reassign (and desync orders.merchant_id from the attempt log).
  const { rowCount } = await getPool().query(
    `update orders
        set merchant_id = $2, resolution = null, expires_at = $3, updated_at = now()
      where id = $1 and state = 'payment_detected' and merchant_id = $4`,
    [orderId, merchantId, expiresAt, expectedMerchantId],
  );
  return (rowCount ?? 0) > 0;
}

/** Current state of an order (or null). Used as a pre-broadcast guard for refunds. */
export async function getOrderState(orderId: string): Promise<OrderState | null> {
  const { rows } = await getPool().query<{ state: OrderState }>(`select state from orders where id = $1`, [orderId]);
  return rows[0]?.state ?? null;
}

/* ---- M4: merchant lifecycle, live float, performance stats, disputes ---- */

/** Committed (in-flight) float per merchant: sum of amounts on non-terminal assigned orders. */
export async function committedFloatByMerchant(): Promise<Record<string, number>> {
  const { rows } = await getPool().query<{ merchant_id: string; committed: string }>(
    `select merchant_id, coalesce(sum(amount_usdc), 0) as committed
       from orders
      where merchant_id is not null
        and state in ('pay_instructions','waiting_payment','payment_detected','merchant_confirms','funds_released')
      group by merchant_id`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.merchant_id] = Number(r.committed);
  return out;
}

/** Released/failed attempt counts per merchant from the routing audit log (drives success_rate). */
export async function merchantOutcomeCounts(): Promise<Record<string, { released: number; failed: number }>> {
  const { rows } = await getPool().query<{ merchant_id: string; outcome: string; n: string }>(
    `select merchant_id, outcome, count(*) as n
       from order_routing_attempts
      where outcome in ('released','failed')
      group by merchant_id, outcome`,
  );
  const out: Record<string, { released: number; failed: number }> = {};
  for (const r of rows) {
    const e = (out[r.merchant_id] ??= { released: 0, failed: 0 });
    if (r.outcome === 'released') e.released = Number(r.n);
    else e.failed = Number(r.n);
  }
  return out;
}

/**
 * Avg completion seconds + sample size per merchant on completed orders. Measured from
 * GREATEST(fund_confirmed, the final routing attempt) → funds_released, so the FINAL merchant is only
 * charged for ITS handling window — not the stall time of any predecessor LP that was rerouted away.
 */
export async function merchantCompletionStats(): Promise<Record<string, { avgSecs: number; n: number }>> {
  const { rows } = await getPool().query<{ merchant_id: string; avg_secs: string | null; n: string }>(
    `select o.merchant_id,
            avg(extract(epoch from (rel.created_at - greatest(det.created_at, att.created_at)))) as avg_secs,
            count(*) as n
       from orders o
       join order_events det on det.order_id = o.id and det.event = 'fund_confirmed'
       join order_events rel on rel.order_id = o.id and rel.event = 'funds_released'
       join lateral (
         select created_at from order_routing_attempts a
          where a.order_id = o.id order by sequence desc limit 1
       ) att on true
      where o.state = 'completed' and o.merchant_id is not null
      group by o.merchant_id`,
  );
  const out: Record<string, { avgSecs: number; n: number }> = {};
  for (const r of rows) out[r.merchant_id] = { avgSecs: Number(r.avg_secs ?? 0), n: Number(r.n) };
  return out;
}

/** Upheld-dispute + completed-order counts per merchant (drives dispute_rate). */
export async function merchantDisputeStats(): Promise<Record<string, { upheld: number; completed: number }>> {
  const { rows } = await getPool().query<{ merchant_id: string; upheld: string; completed: string }>(
    `select m.id as merchant_id,
            count(distinct d.id) filter (where d.resolution = 'upheld') as upheld,
            count(distinct o.id) filter (where o.state = 'completed') as completed
       from merchants m
       left join orders o on o.merchant_id = m.id
       left join disputes d on d.merchant_id = m.id
      group by m.id`,
  );
  const out: Record<string, { upheld: number; completed: number }> = {};
  for (const r of rows) out[r.merchant_id] = { upheld: Number(r.upheld), completed: Number(r.completed) };
  return out;
}

/** Write recomputed live signals back to a merchant. */
export async function updateMerchantStats(
  id: string,
  s: { successRate: number; avgCompletionSecs: number; disputeRate: number },
): Promise<void> {
  await getPool().query(
    `update merchants set success_rate = $2, avg_completion_secs = $3, dispute_rate = $4 where id = $1`,
    [id, s.successRate, Math.round(s.avgCompletionSecs), s.disputeRate],
  );
}

export async function setMerchantStatus(id: string, status: 'online' | 'offline' | 'suspended'): Promise<void> {
  await getPool().query(`update merchants set status = $2 where id = $1`, [id, status]);
}

/** Onboarding: create a pending-KYB merchant application (offline until approved). */
export async function insertMerchantApplication(input: {
  name: string;
  payoutRail: PayoutMethod;
  treasuryAddress: string;
}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into merchants (name, payout_rail, status, treasury_address, kyb_status)
     values ($1, $2, 'offline', $3, 'pending')
     returning id`,
    [input.name, input.payoutRail, input.treasuryAddress],
  );
  return rows[0].id;
}

/** Approve/reject a pending application; approval flips it online. */
export async function setMerchantKyb(id: string, decision: 'approve' | 'reject'): Promise<boolean> {
  const kyb = decision === 'approve' ? 'approved' : 'rejected';
  const status = decision === 'approve' ? 'online' : 'offline';
  const { rowCount } = await getPool().query(
    `update merchants set kyb_status = $2, status = $3 where id = $1 and kyb_status = 'pending'`,
    [id, kyb, status],
  );
  return (rowCount ?? 0) > 0;
}

/** Draw a merchant's bond down (floored at 0) when a dispute is upheld against them. */
export async function drawDownBond(merchantId: string, amount: number): Promise<void> {
  await getPool().query(`update merchants set bond_usdc = greatest(bond_usdc - $2, 0) where id = $1`, [
    merchantId,
    amount,
  ]);
}

export async function insertDispute(input: { orderId: string; merchantId: string; reason?: string }): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into disputes (order_id, merchant_id, reason) values ($1, $2, $3) returning id`,
    [input.orderId, input.merchantId, input.reason ?? null],
  );
  return rows[0].id;
}

export async function getDisputeRow(
  id: string,
): Promise<{ id: string; orderId: string; merchantId: string; status: string } | null> {
  const { rows } = await getPool().query<{ id: string; order_id: string; merchant_id: string; status: string }>(
    `select id, order_id, merchant_id, status from disputes where id = $1`,
    [id],
  );
  const r = rows[0];
  return r ? { id: r.id, orderId: r.order_id, merchantId: r.merchant_id, status: r.status } : null;
}

export async function resolveDispute(id: string, resolution: 'upheld' | 'rejected'): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update disputes set status = 'resolved', resolution = $2, resolved_at = now()
      where id = $1 and status = 'open'`,
    [id, resolution],
  );
  return (rowCount ?? 0) > 0;
}

/** Order fields needed to open a dispute (owner-scoped); null if not the owner or no merchant. */
export async function getOrderForDispute(
  orderId: string,
  userId: string,
): Promise<{ merchantId: string; amountUsdc: number; state: OrderState } | null> {
  const { rows } = await getPool().query<{ merchant_id: string | null; amount_usdc: string; state: OrderState }>(
    `select merchant_id, amount_usdc, state from orders where id = $1 and user_id = $2`,
    [orderId, userId],
  );
  const r = rows[0];
  return r && r.merchant_id ? { merchantId: r.merchant_id, amountUsdc: Number(r.amount_usdc), state: r.state } : null;
}

/* ---- M5: KYC tiers, rolling volume, screening, risk audit ---- */

export async function getUserKycTier(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ kyc_tier: number }>('select kyc_tier from users where id = $1', [userId]);
  return rows[0]?.kyc_tier ?? 0;
}

export async function setUserKycTier(userId: string, tier: number): Promise<void> {
  await getPool().query('update users set kyc_tier = $2 where id = $1', [userId, tier]);
}

/** The user's confirmed/pending P2P send volume (USD) in the last `hours`. */
export async function recentSendVolumeUsd(userId: string, hours: number): Promise<number> {
  const { rows } = await getPool().query<{ total: string }>(
    `select coalesce(sum(amount_usdc), 0) as total
       from transfers
      where from_user_id = $1 and kind = 'send' and status <> 'failed'
        and created_at > now() - make_interval(hours => $2)`,
    [userId, hours],
  );
  return Number(rows[0].total);
}

/** The user's in-flight/completed cash-out (order) volume (USD) in the last `hours`. */
export async function recentCashOutVolumeUsd(userId: string, hours: number): Promise<number> {
  const { rows } = await getPool().query<{ total: string }>(
    `select coalesce(sum(amount_usdc), 0) as total
       from orders
      where user_id = $1 and state not in ('failed','refunded')
        and created_at > now() - make_interval(hours => $2)`,
    [userId, hours],
  );
  return Number(rows[0].total);
}

export async function isDenylisted(kind: 'address' | 'handle', value: string): Promise<boolean> {
  const { rowCount } = await getPool().query('select 1 from denylist where kind = $1 and value = $2', [kind, value]);
  return (rowCount ?? 0) > 0;
}

export async function insertRiskEvent(input: {
  userId: string;
  kind: string;
  amountUsd?: number;
  decision: 'allow' | 'review' | 'block';
  score: number;
  reason?: string;
}): Promise<void> {
  await getPool().query(
    `insert into risk_events (user_id, kind, amount_usdc, decision, score, reason) values ($1,$2,$3,$4,$5,$6)`,
    [input.userId, input.kind, input.amountUsd ?? null, input.decision, input.score, input.reason ?? null],
  );
}

/* ---- M6: notifications + per-user advisory lock ---- */

export async function insertNotification(input: {
  userId: string;
  kind: string;
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await getPool().query(
    `insert into notifications (user_id, kind, title, body, meta) values ($1,$2,$3,$4,$5)`,
    [input.userId, input.kind, input.title, input.body ?? null, input.meta ? JSON.stringify(input.meta) : null],
  );
}

export async function listNotifications(userId: string, limit = 30): Promise<Notification[]> {
  const { rows } = await getPool().query<{
    id: string;
    kind: string;
    title: string;
    body: string | null;
    meta: Record<string, unknown> | null;
    read: boolean;
    created_at: Date;
  }>(
    `select id, kind, title, body, meta, read, created_at
       from notifications where user_id = $1 order by created_at desc limit $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    meta: r.meta ?? undefined,
    read: r.read,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(
    `select count(*) as n from notifications where user_id = $1 and read = false`,
    [userId],
  );
  return Number(rows[0].n);
}

export async function markNotificationRead(id: string, userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update notifications set read = true where id = $1 and user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await getPool().query(`update notifications set read = true where user_id = $1 and read = false`, [userId]);
}

/**
 * Serialize a per-user critical section with a session advisory lock — so concurrent requests for the
 * same user can't race a read-then-write (e.g. the M5 daily-cap check + insert). The lock is held on a
 * dedicated pooled connection for the duration of `fn`; other callers for the same user block on it.
 */
export async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [userId]);
    return await fn();
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', [userId]).catch(() => {});
    client.release();
  }
}

/** Owner + amount for a completed order (notification on cash-out completion). */
export async function getOrderUserAmount(orderId: string): Promise<{ userId: string; amountUsdc: number } | null> {
  const { rows } = await getPool().query<{ user_id: string; amount_usdc: string }>(
    `select user_id, amount_usdc from orders where id = $1`,
    [orderId],
  );
  return rows[0] ? { userId: rows[0].user_id, amountUsdc: Number(rows[0].amount_usdc) } : null;
}

/** Recipient + amount + sender handle for a confirmed P2P send (notify the receiver). */
export async function getSendNotifyInfo(
  transferId: string,
): Promise<{ toUserId: string; amountUsd: number; fromHandle: string } | null> {
  const { rows } = await getPool().query<{ to_user_id: string | null; amount_usdc: string; from_handle: string | null }>(
    `select t.to_user_id, t.amount_usdc, u.handle as from_handle
       from transfers t left join users u on u.id = t.from_user_id
      where t.id = $1 and t.kind = 'send'`,
    [transferId],
  );
  const r = rows[0];
  return r && r.to_user_id
    ? { toUserId: r.to_user_id, amountUsd: Number(r.amount_usdc), fromHandle: r.from_handle ?? 'Someone' }
    : null;
}

/** Requester + amount for a payment request (notify them it was paid). */
export async function getRequestNotifyInfo(requestId: string): Promise<{ fromUserId: string; amountUsd: number } | null> {
  const { rows } = await getPool().query<{ from_user_id: string; amount_usdc: string }>(
    `select from_user_id, amount_usdc from payment_requests where id = $1`,
    [requestId],
  );
  return rows[0] ? { fromUserId: rows[0].from_user_id, amountUsd: Number(rows[0].amount_usdc) } : null;
}
