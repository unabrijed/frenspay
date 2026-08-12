// queries.ts — typed data access over the lazy pg pool (db/pool.ts).
// Maps rows to the @fpay/shared wire DTOs. Phase 1 is USDC-only, so no rupee column.
import type { PoolClient } from 'pg';

import type {
  AdminAction,
  AdminDenylistEntry,
  AdminInviteCode,
  AdminMerchant,
  AdminOrder,
  AdminOrderDetailResponse,
  AdminOverviewResponse,
  AdminRiskEvent,
  AdminUser,
  AdminWaitlistEntry,
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
} from '@fpay/shared';

import { INVITES_PER_USER, mintCode } from '../services/invites';

import { getLockPool, getPool } from './pool';

export type TransferKind = 'send' | 'add' | 'pay' | 'escrow_fund' | 'escrow_release';

export interface UserRow {
  id: string;
  privy_did: string;
  handle: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  role: 'user' | 'merchant' | 'admin';
  referred_by: string | null;
  /** Stamped once the user has seen their invite codes; after that /me stops returning them. */
  invites_revealed_at: Date | null;
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

// --- alias validators (backend-local; the client has its own copies — shared exports no runtime
// values to the backend by invariant). Handle is the payment ID; phone is the pay-by-phone alias.
const HANDLE_BODY_RE = /^[a-z0-9_.]{3,30}$/;

/** '@Bridge ' → '@bridge'; null if not a valid handle. Canonical stored form keeps the '@'. */
export function canonicalHandle(raw: string): string | null {
  const body = raw.trim().replace(/^@/, '').toLowerCase();
  return HANDLE_BODY_RE.test(body) ? '@' + body : null;
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

/** ' +91 98765-43210' → '+919876543210'; null if not E.164. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
  return E164_RE.test(s) ? s : null;
}

// --- keyset pagination: cursor = '<createdAtISO>|<id>' of the last row of the previous page.
export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

function parseCursor(cursor?: string): { at: string; id: string } | null {
  if (!cursor) return null;
  const i = cursor.lastIndexOf('|');
  if (i <= 0) return null;
  const at = cursor.slice(0, i);
  return Number.isNaN(Date.parse(at)) ? null : { at, id: cursor.slice(i + 1) };
}

const clampLimit = (limit: number, def: number, max: number): number =>
  Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), max) : def;

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>('select * from users where id = $1', [id]);
  return rows[0] ?? null;
}

export async function findUserByHandle(handle: string): Promise<UserRow | null> {
  const h = canonicalHandle(handle);
  if (!h) return null;
  const { rows } = await getPool().query<UserRow>('select * from users where handle = $1', [h]);
  return rows[0] ?? null;
}

export async function findUserByPrivyDid(did: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>('select * from users where privy_did = $1', [did]);
  return rows[0] ?? null;
}

/**
 * Insert `count` fresh codes for an owner (null = house code), returning what actually landed.
 *
 * `onlyIfNone` makes it idempotent for the per-account grant: a replayed sync, or two /me calls
 * racing, must not hand anyone a second set of three. It is safe only while the caller holds a lock
 * on the owner's user row — both callers do (the sync txn has just written it; ensureInviteCodes
 * takes `for update` first).
 *
 * `on conflict (code) do nothing` covers the ~1e-8 collision. The caller gets the codes that landed
 * rather than the codes we hoped for, so a shortfall is visible instead of imaginary.
 */
async function mintCodesFor(
  // Pool and PoolClient both satisfy this — the sync path needs its own client (it is mid-
  // transaction), the admin path does not.
  client: Pick<PoolClient, 'query'>,
  ownerId: string | null,
  count: number,
  opts: { onlyIfNone?: boolean; note?: string } = {},
): Promise<string[]> {
  const { rows } = await client.query<{ code: string }>(
    `insert into invite_codes (code, owner_id, note)
     select c, $2, $3 from unnest($1::text[]) as c
      where $4::boolean is false or not exists (select 1 from invite_codes where owner_id = $2)
     on conflict (code) do nothing
     returning code`,
    [Array.from({ length: count }, mintCode), ownerId, opts.note ?? null, Boolean(opts.onlyIfNone)],
  );
  return rows.map((r) => r.code);
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
  country?: string;
  /** Privy-verified login address, persisted so the console can show it and ADMIN_EMAILS can match. */
  email?: string;
  /** CANONICAL invite code to burn — set only when this sync creates the account. */
  inviteCode?: string;
}): Promise<UserRow> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    let referredBy: string | null = null;
    if (input.inviteCode) {
      // The whole gate, in one statement. `for update` on the code row IS the concurrency control:
      // two people racing the same code both block here, and whoever loses re-reads a row with
      // redeemed_at set and falls out below. This replaced a lock-the-referrer-then-count-in-a-
      // second-statement dance — one row, one lock, no counting.
      const { rows: codeRows } = await client.query<{ owner_id: string | null }>(
        `select owner_id from invite_codes
          where code = $1 and redeemed_at is null and revoked_at is null
          for update`,
        [input.inviteCode],
      );
      // Unknown, already burned, and revoked are ONE error on purpose: distinguishing them would
      // turn this into an oracle telling a guesser which codes exist.
      if (!codeRows[0]) throw Object.assign(new Error('invalid_invite'), { code: 'invalid_invite' });
      // NULL for a house code — the account is created with no referrer, which is correct: nobody
      // invited them.
      referredBy = codeRows[0].owner_id;
    }
    // Handle is IMMUTABLE after first sync (the onboarding UI promises "can't be changed later",
    // and a freed handle could be re-claimed → payments misdirected). display_name coalesces so a
    // sync without one doesn't null it out. country is the browser-locale guess — the WEAKEST
    // source, so it fills only when NULL (verified-phone/manual picks overwrite via /me/country).
    // email is the opposite: Privy is authoritative, so a fresh value wins and a missing one leaves
    // what's there. referred_by is NOT in the conflict update: a re-sync must never rewrite lineage.
    const { rows } = await client.query<UserRow>(
      `insert into users (privy_did, handle, display_name, country, email, referred_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (privy_did) do update
         set display_name = coalesce(excluded.display_name, users.display_name),
             country = coalesce(users.country, excluded.country),
             email = coalesce(excluded.email, users.email)
       returning *`,
      [
        input.privyDid,
        input.handle,
        input.displayName ?? null,
        input.country ?? null,
        input.email ?? null,
        referredBy,
      ],
    );
    const user = rows[0];
    if (input.inviteCode) {
      // Burn it. Same transaction as the account it let in, so there is no window where a code is
      // spent but the account doesn't exist (or the reverse).
      await client.query(
        `update invite_codes set redeemed_by = $2, redeemed_at = now() where code = $1`,
        [input.inviteCode, user.id],
      );
    }
    // Their own three, minted in the same breath. `where not exists` makes this idempotent, so a
    // replayed sync can't hand anyone a second set.
    await mintCodesFor(client, user.id, INVITES_PER_USER, { onlyIfNone: true });
    await client.query(
      `insert into wallets (user_id, address) values ($1, $2)
       on conflict (user_id, chain) do update set address = excluded.address`,
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

export async function getWalletForUser(userId: string, chain = 'solana'): Promise<WalletRow | null> {
  const { rows } = await getPool().query<WalletRow>(
    'select * from wallets where user_id = $1 and chain = $2 order by created_at asc limit 1',
    [userId, chain],
  );
  return rows[0] ?? null;
}

export async function resolveHandleToFriend(handle: string): Promise<Friend | null> {
  const h = canonicalHandle(handle);
  if (!h) return null;
  const { rows } = await getPool().query<{ handle: string; display_name: string | null }>(
    'select handle, display_name from users where handle = $1',
    [h],
  );
  return rows[0] ? toFriend(rows[0]) : null;
}

/** Pay-by-phone mapper lookup. Input must already be normalized E.164. Never returns the phone
 *  itself — reverse lookup (alias → number) is structurally impossible, like UPI's mapper. */
export async function findUserByPhone(phone: string): Promise<Friend | null> {
  const { rows } = await getPool().query<{ handle: string; display_name: string | null }>(
    'select handle, display_name from users where phone = $1',
    [phone],
  );
  return rows[0] ? toFriend(rows[0]) : null;
}

/** Enroll (E.164) or de-enroll (null) the user in pay-by-phone. 23505 = number already enrolled. */
export async function setUserPhone(userId: string, phone: string | null): Promise<void> {
  await getPool().query('update users set phone = $2 where id = $1', [userId, phone]);
}

/** Set the dialing-default country (validated ISO alpha-2). Strong sources last-write-wins. */
export async function setUserCountry(userId: string, country: string): Promise<void> {
  await getPool().query('update users set country = $2 where id = $1', [userId, country]);
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
  from_address: string | null;
  to_address: string | null;
  chain: string | null;
  bridge_state: string | null;
  bridge_direction: string | null;
  bridge_source_chain: string | null;
  bridge_dest_chain: string | null;
}

export async function listTransactionsForUser(
  userId: string,
  limit = 50,
  cursor?: string,
): Promise<Page<ApiTxn>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  // Keyset on (created_at, id): stable under new inserts, rides the created_at ordering. Fetch
  // n+1 rows to learn whether a next page exists without a count.
  const { rows } = await getPool().query<TransferJoinRow>(
    `select t.id, t.kind, t.amount_usdc, t.note, t.status, t.created_at, t.signature,
            t.from_user_id, t.to_user_id, t.from_address, t.to_address, t.chain,
            fu.handle as from_handle, tu.handle as to_handle,
            b.state as bridge_state, b.direction as bridge_direction,
            b.source_chain as bridge_source_chain, b.destination_chain as bridge_dest_chain
       from transfers t
       left join users fu on fu.id = t.from_user_id
       left join users tu on tu.id = t.to_user_id
       left join bridge_transfers b on b.transfer_id = t.id
      where (t.from_user_id = $1 or t.to_user_id = $1)
        and ($3::timestamptz is null or (t.created_at, t.id) < ($3::timestamptz, $4::uuid))
      order by t.created_at desc, t.id desc
      limit $2`,
    [userId, n + 1, c?.at ?? null, c?.id ?? null],
  );

  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined;

  const items = pageRows.map((r): ApiTxn => {
    const direction: 'in' | 'out' = r.from_user_id === userId ? 'out' : 'in';
    const counterpartyHandle = (direction === 'out' ? r.to_handle : r.from_handle) ?? undefined;
    // External counterparty (no fpay user on the other side) → surface the raw address so the
    // feed can render something better than a blank "To ".
    const counterpartyAddress = counterpartyHandle
      ? undefined
      : ((direction === 'out' ? r.to_address : r.from_address) ?? undefined);
    // Cross-chain rows: the companion transfers row is always the SOLANA leg, but the user-facing
    // chain is the EVM side, and status stays pending until the money actually lands (settled).
    const bridged = r.bridge_state != null;
    const bridgeChain = r.bridge_direction === 'in' ? r.bridge_source_chain : r.bridge_dest_chain;
    const bridgeStatus: ApiTxn['status'] =
      r.bridge_state === 'settled' ? 'confirmed' : r.bridge_state === 'failed' ? 'failed' : 'pending';
    return {
      id: r.id,
      kind: r.kind,
      direction,
      amountUsd: r.amount_usdc,
      counterpartyHandle,
      counterpartyAddress,
      chain: (bridged ? bridgeChain : r.chain) ?? undefined,
      note: r.note ?? undefined,
      status: bridged ? bridgeStatus : (r.status as ApiTxn['status']),
      createdAt: r.created_at.toISOString(),
      signature: r.signature ?? undefined,
    };
  });
  return { items, nextCursor };
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
      amountUsd: r.amount_usdc,
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
    amountUsd: r.amount_usdc,
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
  chain?: string;
  idempotencyKey?: string;
}): Promise<{ id: string }> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into transfers (from_user_id, to_user_id, from_address, to_address, amount_usdc, kind, note, status, chain, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
     returning id`,
    [
      input.fromUserId,
      input.toUserId,
      input.fromAddress,
      input.toAddress,
      input.amountUsd,
      input.kind ?? 'send',
      input.note ?? null,
      input.chain ?? 'solana',
      input.idempotencyKey ?? null,
    ],
  );
  return rows[0];
}

/** Prepare-dedupe lookup: the transfer a sender already created under this idempotency key.
 *  Returns enough of the row to rebuild the unsigned tx for an idempotent replay. */
export async function findTransferByIdempotencyKey(
  fromUserId: string,
  idempotencyKey: string,
): Promise<{ id: string; status: string; signature: string | null; fromAddress: string; toAddress: string; amountUsd: string } | null> {
  const { rows } = await getPool().query<{
    id: string;
    status: string;
    signature: string | null;
    from_address: string;
    to_address: string;
    amount_usdc: string;
  }>(
    `select id, status, signature, from_address, to_address, amount_usdc
       from transfers where from_user_id = $1 and idempotency_key = $2`,
    [fromUserId, idempotencyKey],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        status: r.status,
        signature: r.signature,
        fromAddress: r.from_address,
        toAddress: r.to_address,
        amountUsd: r.amount_usdc,
      }
    : null;
}

/** Distinct external (non-fpay) recipients this sender used in the last `hours`. Bounds the
 *  fee-payer ATA-rent drain: each fresh external recipient can cost ~0.002 SOL in rent. */
export async function countRecentExternalRecipients(fromUserId: string, hours: number): Promise<number> {
  const { rows } = await getPool().query<{ total: string }>(
    `select count(distinct to_address) as total
       from transfers
      where from_user_id = $1 and to_user_id is null and kind = 'send' and status <> 'failed'
        and created_at > now() - make_interval(hours => $2)`,
    [fromUserId, hours],
  );
  return Number(rows[0].total);
}

/** Is this address a merchant settlement treasury? Untracked deposits there are effectively lost. */
export async function isMerchantTreasuryAddress(address: string): Promise<boolean> {
  const { rowCount } = await getPool().query('select 1 from merchants where treasury_address = $1', [address]);
  return (rowCount ?? 0) > 0;
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
): Promise<boolean> {
  // Transition-gated (`status <> $2`) so the poller can't re-fire order-advance/notify on a row the
  // Helius webhook already finalized in the same tick. Returns true only on a real transition.
  const { rowCount } = await getPool().query(
    `update transfers
        set status = $2,
            confirmed_at = case when $2 = 'confirmed' then now() else confirmed_at end
      where id = $1 and status <> $2`,
    [transferId, status],
  );
  return (rowCount ?? 0) > 0;
}

export async function setTransferStatusBySignature(
  signature: string,
  status: 'pending' | 'confirmed' | 'failed',
): Promise<string | null> {
  // Returns the transfer id only when the row actually transitioned (status changed) — so a webhook
  // re-delivery, or a row the poller already finalized, can't re-fire order advancement / notifications.
  const { rows } = await getPool().query<{ id: string }>(
    `update transfers
        set status = $2,
            confirmed_at = case when $2 = 'confirmed' then now() else confirmed_at end
      where signature = $1 and status <> $2
      returning id`,
    [signature, status],
  );
  return rows[0]?.id ?? null;
}

export async function getPendingSignatures(): Promise<{ id: string; signature: string }[]> {
  // chain filter is load-bearing: this feeds the SOLANA poller only — a foreign-chain signature
  // followed here would sit permanent-pending (see the transfers.chain comment in schema.sql).
  const { rows } = await getPool().query<{ id: string; signature: string }>(
    `select id, signature from transfers
      where status = 'pending' and signature is not null and chain = 'solana'`,
  );
  return rows;
}

/**
 * Retire transfers abandoned after /transfer/prepare: still pending, never signed, older than
 * maxAgeMin. The confirmer poller only follows signed rows (getPendingSignatures), so without
 * this sweep these would stay pending forever. Returns how many were expired.
 */
export async function expireStaleUnsignedTransfers(maxAgeMin = 15): Promise<number> {
  // Bridge companions are excluded: an inbound mint leg legitimately sits unsigned-pending for
  // the whole attestation window; the bridge machine owns that lifecycle (docs/19).
  const { rowCount } = await getPool().query(
    `update transfers
        set status = 'failed'
      where status = 'pending' and signature is null
        and created_at < now() - make_interval(mins => $1)
        and not exists (select 1 from bridge_transfers b where b.transfer_id = transfers.id)`,
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
  positive_rate: string;
  kyb_status: 'pending' | 'approved' | 'rejected';
  bond_usdc: string;
  base_success_rate: string;
  base_avg_completion_secs: number;
  base_dispute_rate: string;
  /** NULL = a REAL (human) merchant — the sim worker must not drive it.
   *  'psp' = a platform settlement row (docs/23): the payout provider executes the fiat leg. */
  sim_behavior: 'happy' | 'slow' | 'no_receipt' | 'timeout' | 'psp' | null;
  user_id: string | null;
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

/* ---- payout-provider registry (docs/23; migration 0005) ---- */

export interface PayoutProviderRow {
  id: string;
  adapter: string;
  payout_method: string; // a PAYOUT_METHODS entry, or '*' (serves every rail)
  priority: number;
  enabled: boolean;
}

/** Enabled rows serving a rail, minus ids already tried on this order — priority asc, ties by id
 *  (a total order, so "next" is well-defined). The credential gate lives in the caller
 *  (services/payout/provider.ts): a row is data, never sufficient to move money on its own. */
export async function listPayoutProviderRows(
  payoutMethod: string,
  excludeIds: readonly string[],
): Promise<PayoutProviderRow[]> {
  const { rows } = await getPool().query<PayoutProviderRow>(
    `select * from payout_providers
      where enabled and payout_method in ($1, '*') and id <> all($2::text[])
      order by priority, id`,
    [payoutMethod, excludeIds as string[]],
  );
  return rows;
}

/** By id, DISABLED ROWS INCLUDED: a sticky order keeps polling the account that may hold its
 *  money — disable affects selection only (project-model invariant 13). */
export async function getPayoutProviderRow(id: string): Promise<PayoutProviderRow | null> {
  const { rows } = await getPool().query<PayoutProviderRow>(`select * from payout_providers where id = $1`, [id]);
  return rows[0] ?? null;
}

/** Admin console read — every row, ladder order. */
export async function listAllPayoutProviders(): Promise<PayoutProviderRow[]> {
  const { rows } = await getPool().query<PayoutProviderRow>(`select * from payout_providers order by priority, id`);
  return rows;
}

/** Admin console write: enabled/priority only — the SUBTRACT-only surface (invariant 11). Rows are
 *  created by seed/SQL, adapters by deploys; there is deliberately no insert or delete here. */
export async function updatePayoutProvider(
  id: string,
  patch: { enabled?: boolean; priority?: number },
): Promise<PayoutProviderRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.enabled !== undefined) {
    sets.push(`enabled = $${++i}`);
    vals.push(patch.enabled);
  }
  if (patch.priority !== undefined) {
    sets.push(`priority = $${++i}`);
    vals.push(patch.priority);
  }
  if (!sets.length) return getPayoutProviderRow(id);
  const { rows } = await getPool().query<PayoutProviderRow>(
    `update payout_providers set ${sets.join(', ')} where id = $1 returning *`,
    [id, ...vals],
  );
  return rows[0] ?? null;
}

interface QuoteRow {
  id: string;
  user_id: string;
  merchant_id: string | null;
  direction: OrderDirection;
  currency: string;
  amount_inr: string;
  amount_usdc: string;
  rate: string;
  eta_min_secs: number;
  eta_max_secs: number;
  payout_method: PayoutMethod;
  route_quality: RouteQuality;
  payout_destination: string | null;
  payout_name: string | null;
  created_at: Date;
  expires_at: Date;
  merchant_name: string | null;
}

function toQuote(r: QuoteRow): Quote {
  return {
    id: r.id,
    direction: r.direction,
    currency: r.currency,
    amountInr: r.amount_inr,
    amountUsdc: r.amount_usdc,
    rate: r.rate,
    etaMinSecs: r.eta_min_secs,
    etaMaxSecs: r.eta_max_secs,
    payoutMethod: r.payout_method,
    routeQuality: r.route_quality,
    merchantName: r.merchant_name ?? 'Best route',
    payoutDestination: r.payout_destination ?? undefined,
    payoutName: r.payout_name ?? undefined,
    quotedAt: r.created_at.getTime(),
    expiresAt: r.expires_at.getTime(),
  };
}

export async function insertQuote(input: {
  userId: string;
  merchantId: string | null;
  direction: OrderDirection;
  currency: string;
  // Canonical decimal strings, not numbers: pg hands numeric back as a string and takes one just
  // as happily, so the value goes in and comes out byte-identical with no float in the middle.
  amountInr: string;
  amountUsdc: string;
  rate: string;
  /** The platform's in-rate cut in USDC — backend-internal, never in the Quote DTO. */
  platformFeeUsdc: string;
  etaMinSecs: number;
  etaMaxSecs: number;
  payoutMethod: PayoutMethod;
  routeQuality: RouteQuality;
  payoutDestination?: string | null;
  payoutName?: string | null;
  expiresAt: Date;
}): Promise<Quote> {
  const { rows } = await getPool().query<QuoteRow>(
    `with ins as (
       insert into quotes (user_id, merchant_id, direction, currency, amount_inr, amount_usdc, rate,
                           platform_fee_usdc, eta_min_secs, eta_max_secs,
                           payout_method, route_quality, payout_destination, payout_name, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       returning *
     )
     select ins.*, m.name as merchant_name
       from ins left join merchants m on m.id = ins.merchant_id`,
    [
      input.userId,
      input.merchantId,
      input.direction,
      input.currency,
      input.amountInr,
      input.amountUsdc,
      input.rate,
      input.platformFeeUsdc,
      input.etaMinSecs,
      input.etaMaxSecs,
      input.payoutMethod,
      input.routeQuality,
      input.payoutDestination ?? null,
      input.payoutName ?? null,
      input.expiresAt,
    ],
  );
  return toQuote(rows[0]);
}

/** Raw quote row scoped to its owner — used at order-confirm time to re-check expiry. */
export async function getQuoteRowForUser(
  quoteId: string,
  userId: string,
): Promise<{
  id: string;
  merchantId: string | null;
  amountUsdc: number;
  /** Raw numeric string, NOT a number — the deposit split subtracts it exactly (a float difference
   *  can exceed 6dp and parseAmount throws at the chain edge). */
  platformFeeUsdc: string;
  expiresAt: Date;
} | null> {
  const { rows } = await getPool().query<{
    id: string;
    merchant_id: string | null;
    amount_usdc: string;
    platform_fee_usdc: string;
    expires_at: Date;
  }>(
    'select id, merchant_id, amount_usdc, platform_fee_usdc, expires_at from quotes where id = $1 and user_id = $2',
    [quoteId, userId],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        merchantId: r.merchant_id,
        amountUsdc: Number(r.amount_usdc),
        platformFeeUsdc: r.platform_fee_usdc,
        expiresAt: r.expires_at,
      }
    : null;
}

/** The platform's in-rate cut for an order, as the raw numeric string ("0.000000" on pre-fee rows). */
export async function getOrderPlatformFee(orderId: string): Promise<string> {
  const { rows } = await getPool().query<{ platform_fee_usdc: string }>(
    'select q.platform_fee_usdc from orders o join quotes q on q.id = o.quote_id where o.id = $1',
    [orderId],
  );
  return rows[0]?.platform_fee_usdc ?? '0';
}

interface OrderJoinRow {
  id: string;
  user_id: string;
  state: OrderState;
  resolution: OrderResolution | null;
  amount_usdc: string;
  reference_code: string;
  payout_claimed_at: Date | null;
  feedback_up: boolean | null;
  created_at: Date;
  updated_at: Date;
  quote_id: string;
  // joined quote columns (aliased)
  q_direction: OrderDirection;
  q_currency: string;
  q_amount_inr: string;
  q_amount_usdc: string;
  q_rate: string;
  q_eta_min_secs: number;
  q_eta_max_secs: number;
  q_payout_method: PayoutMethod;
  q_route_quality: RouteQuality;
  q_payout_destination: string | null;
  q_payout_name: string | null;
  q_created_at: Date;
  q_expires_at: Date;
  merchant_name: string | null;
}

const ORDER_SELECT = `
  select o.id, o.user_id, o.state, o.resolution, o.amount_usdc, o.reference_code,
         o.payout_claimed_at, o.feedback_up, o.created_at, o.updated_at, o.quote_id,
         q.direction as q_direction, q.currency as q_currency, q.amount_inr as q_amount_inr, q.amount_usdc as q_amount_usdc,
         q.rate as q_rate,
         q.eta_min_secs as q_eta_min_secs, q.eta_max_secs as q_eta_max_secs,
         q.payout_method as q_payout_method, q.route_quality as q_route_quality,
         q.payout_destination as q_payout_destination, q.payout_name as q_payout_name,
         q.created_at as q_created_at, q.expires_at as q_expires_at,
         m.name as merchant_name
    from orders o
    join quotes q on q.id = o.quote_id
    left join merchants m on m.id = o.merchant_id`;

function toOrder(r: OrderJoinRow, events?: OrderEvent[]): Order {
  const quote: Quote = {
    id: r.quote_id,
    direction: r.q_direction,
    currency: r.q_currency,
    amountInr: r.q_amount_inr,
    amountUsdc: r.q_amount_usdc,
    rate: r.q_rate,
    etaMinSecs: r.q_eta_min_secs,
    etaMaxSecs: r.q_eta_max_secs,
    payoutMethod: r.q_payout_method,
    routeQuality: r.q_route_quality,
    merchantName: r.merchant_name ?? 'Best route',
    payoutDestination: r.q_payout_destination ?? undefined,
    payoutName: r.q_payout_name ?? undefined,
    quotedAt: r.q_created_at.getTime(),
    expiresAt: r.q_expires_at.getTime(),
  };
  return {
    id: r.id,
    state: r.state,
    resolution: r.resolution,
    direction: r.q_direction,
    referenceCode: r.reference_code,
    amountUsdc: r.amount_usdc,
    quote,
    merchantName: quote.merchantName,
    payoutMethod: r.q_payout_method,
    payoutClaimedAt: r.payout_claimed_at?.toISOString(),
    feedbackUp: r.feedback_up ?? undefined,
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

export async function listOrdersForUser(
  userId: string,
  limit = 50,
  cursor?: string,
): Promise<Page<Order>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<OrderJoinRow>(
    `${ORDER_SELECT}
      where o.user_id = $1
        and ($3::timestamptz is null or (o.created_at, o.id) < ($3::timestamptz, $4::uuid))
      order by o.created_at desc, o.id desc limit $2`,
    [userId, n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => toOrder(r)),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
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
  /** NULL = a real (human) merchant — the sim behaviours must not be applied to it.
   *  'psp' = the payout provider (services/payout) executes the fiat leg via API. */
  sim_behavior: 'happy' | 'slow' | 'no_receipt' | 'timeout' | 'psp' | null;
  payout_method: PayoutMethod | null;
  /** Fiat leg the provider disburses (quote columns; names from the India-only era). */
  currency: string;
  amount_inr: string;
  payout_destination: string | null;
  payout_name: string | null;
  /** Non-null once a real merchant reported paying the fiat leg (the dispute window is running). */
  payout_claimed_at: Date | null;
  /** Sticky provider binding (invariant 13): set before the first initiate, advanced only via CAS. */
  payout_provider_id: string | null;
  /** The failover exclusion set — every provider id ever bound on this order. */
  payout_providers_tried: string[];
  /** The vendor's own payout id, once check() reports one. */
  payout_provider_ref: string | null;
  /** Live, so the worker never releases escrow on an order the payer is actively disputing. */
  dispute_open: boolean;
}

/** Orders the merchant worker drives (mid-flow, awaiting the LP) — simulated and real alike. */
export async function listWorkerOrders(): Promise<WorkerOrderRow[]> {
  const { rows } = await getPool().query<WorkerOrderRow>(
    `select o.id, o.user_id, o.reference_code, o.state, o.resolution, o.amount_usdc, o.updated_at,
            o.expires_at, o.escrow_release_transfer_id, o.merchant_id, o.payout_claimed_at,
            o.payout_provider_id, o.payout_providers_tried, o.payout_provider_ref,
            m.treasury_address, m.sim_behavior, q.payout_method,
            q.currency, q.amount_inr, q.payout_destination, q.payout_name,
            exists (select 1 from disputes d where d.order_id = o.id and d.status = 'open') as dispute_open
       from orders o
       left join merchants m on m.id = o.merchant_id
       join quotes q on q.id = o.quote_id
      where o.state in ('payment_detected','merchant_confirms')`,
  );
  return rows;
}

/** Resolve an order by its public reference — the webhook fast path (poller stays authoritative).
 *  Carries the provider binding so the webhook can assert callback↔order account identity, and
 *  enough context to record an orphaned disbursement instead of dropping the signal. */
export async function getOrderByReference(reference: string): Promise<{
  id: string;
  merchant_id: string | null;
  state: OrderState;
  user_id: string;
  amount_usdc: string;
  payout_provider_id: string | null;
  payout_provider_ref: string | null;
} | null> {
  const { rows } = await getPool().query<{
    id: string;
    merchant_id: string | null;
    state: OrderState;
    user_id: string;
    amount_usdc: string;
    payout_provider_id: string | null;
    payout_provider_ref: string | null;
  }>(
    `select id, merchant_id, state, user_id, amount_usdc, payout_provider_id, payout_provider_ref
       from orders where reference_code = $1`,
    [reference],
  );
  return rows[0] ?? null;
}

/** Includes the merchant's sim_behavior so the caller can pick a human-sized SLA (NULL = real). */
export async function getOrderByEscrowFundTransfer(
  transferId: string,
): Promise<{ id: string; state: OrderState; sim_behavior: string | null } | null> {
  const { rows } = await getPool().query<{ id: string; state: OrderState; sim_behavior: string | null }>(
    `select o.id, o.state, m.sim_behavior
       from orders o left join merchants m on m.id = o.merchant_id
      where o.escrow_fund_transfer_id = $1`,
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
  // Never fail an order whose escrow deposit was already broadcast (signature set) — that would strand
  // funded USDC on-chain with no release/refund path. Only cancel orders that never funded.
  const { rowCount } = await getPool().query(
    `update orders set state = 'failed', updated_at = now()
      where id = $1 and user_id = $2 and state in ('pay_instructions','waiting_payment')
        and not exists (
          select 1 from transfers t where t.id = orders.escrow_fund_transfer_id and t.signature is not null
        )`,
    [orderId, userId],
  );
  if ((rowCount ?? 0) > 0) await appendOrderEvent(orderId, null, 'failed', 'canceled_by_user');
  return (rowCount ?? 0) > 0;
}

/**
 * Retire orders stuck pre-escrow (prepared but never funded) past maxAgeMin — mirrors
 * expireStaleUnsignedTransfers so abandoned orders don't linger in pay_instructions forever.
 */
export async function expireStaleOrders(maxAgeMin = 15): Promise<number> {
  // Only retire orders that never funded (still pay_instructions AND no broadcast deposit). A
  // waiting_payment order means the deposit IS broadcast — leave it for the confirmer, never auto-fail
  // it (that would strand funded escrow on-chain).
  const { rows } = await getPool().query<{ id: string }>(
    `update orders set state = 'failed', updated_at = now()
      where state = 'pay_instructions'
        and created_at < now() - make_interval(mins => $1)
        and not exists (
          select 1 from transfers t where t.id = orders.escrow_fund_transfer_id and t.signature is not null
        )
      returning id`,
    [maxAgeMin],
  );
  for (const r of rows) await appendOrderEvent(r.id, 'pay_instructions', 'failed', 'expired_unfunded');
  return rows.length;
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

/** 👍/👎 counts per merchant (drives positive_rate). Groups by orders.merchant_id, which reroute
 *  rewrites — so feedback lands on the FINAL merchant, same convention as merchantDisputeStats. */
export async function merchantFeedbackStats(): Promise<Record<string, { up: number; n: number }>> {
  const { rows } = await getPool().query<{ merchant_id: string; up: string; n: string }>(
    `select merchant_id, count(*) filter (where feedback_up) as up, count(*) as n
       from orders
      where feedback_up is not null and merchant_id is not null
      group by merchant_id`,
  );
  const out: Record<string, { up: number; n: number }> = {};
  for (const r of rows) out[r.merchant_id] = { up: Number(r.up), n: Number(r.n) };
  return out;
}

/** Write recomputed live signals back to a merchant. */
export async function updateMerchantStats(
  id: string,
  s: { successRate: number; avgCompletionSecs: number; disputeRate: number; positiveRate: number },
): Promise<void> {
  await getPool().query(
    `update merchants set success_rate = $2, avg_completion_secs = $3, dispute_rate = $4, positive_rate = $5
      where id = $1`,
    [id, s.successRate, Math.round(s.avgCompletionSecs), s.disputeRate, s.positiveRate],
  );
}

export async function setMerchantStatus(id: string, status: 'online' | 'offline' | 'suspended'): Promise<void> {
  await getPool().query(`update merchants set status = $2 where id = $1`, [id, status]);
}

/**
 * Onboarding: create a pending-KYB merchant application (offline until approved), owned by a real
 * user. `sim_behavior` is left NULL on purpose — that NULL is what tells the worker this is a human
 * who must act. Inheriting the old 'happy' default would make the worker auto-release the escrow ~4s
 * after payment_detected and the merchant would never see the order. Starts with zero float and zero
 * bond: a real LP has no capacity until it actually stakes.
 */
export async function insertMerchantApplication(input: {
  userId: string;
  name: string;
  payoutRail: PayoutMethod;
  treasuryAddress: string;
}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into merchants (user_id, name, payout_rail, status, treasury_address, kyb_status,
                            sim_behavior, bond_usdc, float_usdc)
     values ($1, $2, $3, 'offline', $4, 'pending', null, 0, 0)
     returning id`,
    [input.userId, input.name, input.payoutRail, input.treasuryAddress],
  );
  // Informational role mirror (capability stays merchants.user_id); never demotes an admin.
  await getPool().query(`update users set role = 'merchant' where id = $1 and role = 'user'`, [input.userId]);
  return rows[0].id;
}

/** The merchant account this user runs, if any — the entire merchant-role signal. */
export async function getMerchantForUser(userId: string): Promise<MerchantRow | null> {
  const { rows } = await getPool().query<MerchantRow>('select * from merchants where user_id = $1', [userId]);
  return rows[0] ?? null;
}

/** Set how much the LP can have in flight at once (its own honest capacity). */
export async function setMerchantFloat(merchantId: string, floatUsdc: number): Promise<void> {
  await getPool().query('update merchants set float_usdc = $2 where id = $1', [merchantId, floatUsdc]);
}

/**
 * Credit a just-confirmed stake deposit to the sender's bond. A stake deposit is an ordinary
 * `kind='send'` transfer (so it still counts against the sender's daily send cap — real USDC leaving
 * their wallet is exactly what that cap measures); the STAKE TREASURY ADDRESS is the discriminator,
 * mirroring how `isMerchantTreasuryAddress` already works. A no-op for every other transfer.
 *
 * Idempotency comes free from the caller: `setTransferStatus` is transition-gated and only reports
 * success on the real pending→confirmed transition, so both the poller and the Helius webhook can
 * race here and only one will have advanced the row. Same guarantee `notifyReceived` relies on.
 */
export async function creditStakeOnConfirm(transferId: string, stakeTreasuryAddress: string): Promise<number> {
  if (!stakeTreasuryAddress) return 0;
  const { rows } = await getPool().query<{ amount_usdc: string }>(
    `update merchants m
        set bond_usdc = m.bond_usdc + t.amount_usdc
       from transfers t
      where t.id = $1 and t.to_address = $2 and t.status = 'confirmed'
        and m.user_id = t.from_user_id
      returning t.amount_usdc`,
    [transferId, stakeTreasuryAddress],
  );
  return rows[0] ? Number(rows[0].amount_usdc) : 0;
}

/**
 * The merchant reports paying the fiat leg. One guarded UPDATE that IS the compare-and-set: the
 * `payout_claimed_at is null` predicate makes a double-tap idempotent (second call affects 0 rows),
 * and `state = 'payment_detected'` means a released/refunded/rerouted order can't be claimed.
 * Opens the dispute window by moving expires_at — the worker releases escrow at that deadline.
 */
/**
 * Bind an order to a payout provider BEFORE its first initiate (invariant 13): vendor idempotency
 * does not span accounts, so the binding — not per-tick selection — is what makes an admin flip or
 * a restart unable to double-disburse. `coalesce` keeps the first writer; the returned id is the
 * binding to actually initiate against (a racing tick gets the same answer, not its own candidate).
 * Also appends to the tried set exactly when this call is the one that bound.
 */
export async function bindOrderPayoutProvider(orderId: string, providerId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ payout_provider_id: string }>(
    `update orders
        set payout_provider_id = coalesce(payout_provider_id, $2),
            payout_providers_tried = case when payout_provider_id is null
                                          then array_append(payout_providers_tried, $2)
                                          else payout_providers_tried end,
            updated_at = now()
      where id = $1 and state = 'payment_detected'
      returning payout_provider_id`,
    [orderId, providerId],
  );
  return rows[0]?.payout_provider_id ?? null;
}

/** Failover: advance the binding from a provider that terminally FAILED to the next one — a CAS on
 *  the old value (the reassignOrderMerchant shape), so two ticks can't both advance. */
export async function advanceOrderPayoutProvider(
  orderId: string,
  fromProviderId: string,
  toProviderId: string,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update orders
        set payout_provider_id = $3,
            payout_providers_tried = array_append(payout_providers_tried, $3),
            payout_provider_ref = null,
            updated_at = now()
      where id = $1 and payout_provider_id = $2 and state = 'payment_detected'`,
    [orderId, fromProviderId, toProviderId],
  );
  return (rowCount ?? 0) > 0;
}

/** Record the vendor's own payout id the first time check() reports one — post-mortem evidence. */
export async function setOrderPayoutProviderRef(orderId: string, ref: string): Promise<void> {
  await getPool().query(
    `update orders set payout_provider_ref = coalesce(payout_provider_ref, $2), updated_at = now() where id = $1`,
    [orderId, ref],
  );
}

export async function claimOrderPayout(input: {
  orderId: string;
  merchantId: string;
  reference: string;
  windowMs: number;
}): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update orders
        set payout_utr = $3, payout_claimed_at = now(), updated_at = now(),
            expires_at = now() + make_interval(secs => $4)
      where id = $1 and merchant_id = $2
        and state = 'payment_detected' and payout_claimed_at is null`,
    [input.orderId, input.merchantId, input.reference, Math.round(input.windowMs / 1000)],
  );
  if ((rowCount ?? 0) > 0) {
    await appendOrderEvent(input.orderId, 'payment_detected', 'payment_detected', 'payout_claimed', {
      utr: input.reference,
    });
  }
  return (rowCount ?? 0) > 0;
}

/**
 * The payer's one-tap 👍/👎 after completion. The predicate is the whole policy: payer-only,
 * completed-only (refunds excluded), once-only — a repeat tap or a race affects 0 rows.
 */
export async function setOrderFeedback(orderId: string, userId: string, up: boolean): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update orders set feedback_up = $3, updated_at = now()
      where id = $1 and user_id = $2 and state = 'completed' and feedback_up is null`,
    [orderId, userId, up],
  );
  return (rowCount ?? 0) > 0;
}

export async function hasOpenDispute(orderId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ n: string }>(
    `select count(*) as n from disputes where order_id = $1 and status = 'open'`,
    [orderId],
  );
  return Number(rows[0].n) > 0;
}

/**
 * Freeze an order the payer is disputing. Nulling `expires_at` is the whole trick: the worker
 * computes `slaReached` as `expires_at ? now >= expires_at : false`, so a null deadline makes BOTH
 * the claimed-release branch and the under_review reroute/refund branch permanently unreachable.
 * The order waits for a human, and the payer sees the existing "under review" copy.
 */
export async function freezeOrderForDispute(orderId: string): Promise<void> {
  const { rowCount } = await getPool().query(
    `update orders set resolution = 'under_review', expires_at = null, updated_at = now()
      where id = $1 and state = 'payment_detected'`,
    [orderId],
  );
  if ((rowCount ?? 0) > 0) {
    await appendOrderEvent(orderId, 'payment_detected', 'payment_detected', 'dispute_frozen');
  }
}

/** Un-freeze after a dispute is rejected — a past deadline makes the next tick release. */
export async function unfreezeOrderAfterDispute(orderId: string): Promise<void> {
  const { rowCount } = await getPool().query(
    `update orders set resolution = null, expires_at = now(), updated_at = now()
      where id = $1 and state = 'payment_detected'`,
    [orderId],
  );
  if ((rowCount ?? 0) > 0) {
    await appendOrderEvent(orderId, 'payment_detected', 'payment_detected', 'dispute_unfrozen');
  }
}

export interface MerchantOrderRow {
  id: string;
  reference_code: string;
  state: OrderState;
  resolution: OrderResolution | null;
  amount_usdc: string;
  payout_utr: string | null;
  payout_claimed_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  currency: string;
  amount_inr: string;
  payout_method: PayoutMethod;
  payout_destination: string | null;
  payout_name: string | null;
}

/** The merchant's work queue: orders assigned to them that are still live. */
export async function listMerchantOrders(merchantId: string, limit = 50): Promise<MerchantOrderRow[]> {
  const { rows } = await getPool().query<MerchantOrderRow>(
    `select o.id, o.reference_code, o.state, o.resolution, o.amount_usdc, o.payout_utr,
            o.payout_claimed_at, o.expires_at, o.created_at,
            q.currency, q.amount_inr, q.payout_method, q.payout_destination, q.payout_name
       from orders o join quotes q on q.id = o.quote_id
      where o.merchant_id = $1
        and o.state in ('payment_detected','merchant_confirms','funds_released','completed')
      order by o.created_at desc
      limit $2`,
    [merchantId, limit],
  );
  return rows;
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
): Promise<{ id: string; orderId: string; merchantId: string; status: string; merchantSimBehavior: string | null } | null> {
  const { rows } = await getPool().query<{
    id: string;
    order_id: string;
    merchant_id: string;
    status: string;
    sim_behavior: string | null;
  }>(
    // sim_behavior along for the ride: 'psp' identifies a platform settlement row, whose bond is
    // exempt from dispute draws (docs/23 — the only bond top-up path is user_id-gated, so a drawn
    // platform row could never recover).
    `select d.id, d.order_id, d.merchant_id, d.status, m.sim_behavior
       from disputes d left join merchants m on m.id = d.merchant_id
      where d.id = $1`,
    [id],
  );
  const r = rows[0];
  return r
    ? { id: r.id, orderId: r.order_id, merchantId: r.merchant_id, status: r.status, merchantSimBehavior: r.sim_behavior }
    : null;
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
): Promise<{
  merchantId: string;
  amountUsdc: number;
  state: OrderState;
  referenceCode: string;
  payoutClaimedAt: Date | null;
} | null> {
  const { rows } = await getPool().query<{
    merchant_id: string | null;
    amount_usdc: string;
    state: OrderState;
    reference_code: string;
    payout_claimed_at: Date | null;
  }>(
    `select merchant_id, amount_usdc, state, reference_code, payout_claimed_at
       from orders where id = $1 and user_id = $2`,
    [orderId, userId],
  );
  const r = rows[0];
  return r && r.merchant_id
    ? {
        merchantId: r.merchant_id,
        amountUsdc: Number(r.amount_usdc),
        state: r.state,
        referenceCode: r.reference_code,
        payoutClaimedAt: r.payout_claimed_at,
      }
    : null;
}

/* ---- M5: KYC tiers, rolling volume, screening, risk audit ---- */

export async function getUserKycTier(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ kyc_tier: number }>('select kyc_tier from users where id = $1', [userId]);
  return rows[0]?.kyc_tier ?? 0;
}

export async function setUserKycTier(userId: string, tier: number): Promise<void> {
  await getPool().query('update users set kyc_tier = $2 where id = $1', [userId, tier]);
}

/* ---- invite-only referrals + landing waitlist ---- */

/** Bootstrap probe: an empty directory founds itself (the first user needs no invite). */
export async function hasAnyUsers(): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>('select exists(select 1 from users)');
  return rows[0].exists;
}

/**
 * Grandfathering, for accounts created before invite codes existed: mint their three on first /me.
 * Cheap no-op afterwards — one indexed existence check.
 *
 * `for update` on the user row is what makes concurrent /me calls safe: mintCodesFor's `not exists`
 * guard would otherwise let two of them both decide the user has none and insert three each.
 */
export async function ensureInviteCodes(userId: string): Promise<void> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    'select exists(select 1 from invite_codes where owner_id = $1)',
    [userId],
  );
  if (rows[0].exists) return;
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('select 1 from users where id = $1 for update', [userId]);
    await mintCodesFor(client, userId, INVITES_PER_USER, { onlyIfNone: true });
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Invite counts for /me, plus the code strings themselves when `includeCodes` — which the caller
 * passes only while users.invites_revealed_at is null. Revoked codes are counted in neither total
 * nor used: an admin taking one back should read as "you have two", not "you wasted one".
 *
 * `::int` — pg returns a bare count(*) (bigint) as a string.
 */
export async function getInviteStats(
  userId: string,
  includeCodes: boolean,
): Promise<{ total: number; used: number; codes?: string[] }> {
  const { rows } = await getPool().query<{ code: string; redeemed_at: Date | null }>(
    `select code, redeemed_at from invite_codes
      where owner_id = $1 and revoked_at is null
      order by created_at asc, code asc`,
    [userId],
  );
  return {
    total: rows.length,
    used: rows.filter((r) => r.redeemed_at !== null).length,
    // All three, burned or not: the reveal screen shows the set they were given, once.
    codes: includeCodes ? rows.map((r) => r.code) : undefined,
  };
}

/** Stamp the one-look flag. `is null` guard makes a second ack a no-op rather than a re-stamp. */
export async function markInvitesRevealed(userId: string): Promise<void> {
  await getPool().query(
    'update users set invites_revealed_at = now() where id = $1 and invites_revealed_at is null',
    [userId],
  );
}

/**
 * The landing gate's read: is this code redeemable right now? Deliberately does NOT reserve it —
 * reservation would need a lock held across a browser redirect and a whole signup. Two people can
 * both get `unused` here and race at /auth/sync, where exactly one wins.
 */
export async function inviteCodeStatus(code: string): Promise<'unused' | 'burned' | 'revoked' | null> {
  const { rows } = await getPool().query<{ redeemed_at: Date | null; revoked_at: Date | null }>(
    'select redeemed_at, revoked_at from invite_codes where code = $1',
    [code],
  );
  const r = rows[0];
  if (!r) return null;
  if (r.revoked_at) return 'revoked';
  return r.redeemed_at ? 'burned' : 'unused';
}

/** F-list signup (public write). Email PK = dedupe. `do update` rather than `do nothing` so one
 *  round trip also returns verified_at (the route needs it to decide whether to re-send the confirm
 *  mail) and so coalesce can backfill columns a legacy row is missing.
 *
 *  Two different coalesce orders, deliberately:
 *   - `city` / `ref_code` read waitlist.* FIRST — write-once. A code is derived from the email and
 *     must never move; the coalesce exists only to backfill rows that predate it.
 *   - `referred_by` reads excluded FIRST — **last touch wins** (Bridge, 2026-08-01). A submit
 *     carrying a ref overwrites the previous referrer; a submit carrying none keeps what's there, so
 *     re-joining without a link can't erase attribution.
 *  Known and accepted cost of last-touch: an already-credited signup can be re-attributed by getting
 *  that person to click a different link and re-submit the same email, and a referrer's fren count
 *  can go down. Self-referral is blocked at the route (routes/waitlist.ts), not here. */
export async function addWaitlistEmail(
  email: string,
  city?: string,
  refCode?: string | null,
  referredBy?: string,
): Promise<{ verifiedAt: Date | null }> {
  const { rows } = await getPool().query<{ verified_at: Date | null }>(
    `insert into waitlist (email, city, ref_code, referred_by) values ($1, $2, $3, $4)
       on conflict (email) do update
          set city        = coalesce(waitlist.city, excluded.city),
              ref_code    = coalesce(waitlist.ref_code, excluded.ref_code),
              referred_by = coalesce(excluded.referred_by, waitlist.referred_by)
     returning verified_at`,
    [email, city ?? null, refCode ?? null, referredBy ?? null],
  );
  return { verifiedAt: rows[0]?.verified_at ?? null };
}

/** 1-based place in the queue. `::int` — pg returns bare count(*) (bigint) as a string.
 *  ponytail: counts the whole table per signup. Materialize a rank if the f list passes ~100k. */
export async function waitlistPosition(email: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `select count(*)::int as n from waitlist
      where created_at <= (select created_at from waitlist where email = $1)`,
    [email],
  );
  return rows[0]?.n ?? 0;
}

/** How many people joined on this member's code — the referral loop's only feedback signal. */
export async function countWaitlistFrens(code: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    'select count(*)::int as n from waitlist where referred_by = $1',
    [code],
  );
  return rows[0]?.n ?? 0;
}

/** Stamp the confirm click. False = already verified; the caller still reports success (clicking the
 *  link twice is a normal thing a human does, not an error). */
export async function verifyWaitlistEmail(email: string): Promise<boolean> {
  const res = await getPool().query(
    'update waitlist set verified_at = now() where email = $1 and verified_at is null',
    [email],
  );
  return (res.rowCount ?? 0) > 0;
}

/* ---- M7: real-vendor KYC session lifecycle ---- */

/** Record a started vendor session against the user and mark them pending. */
export async function setKycSession(userId: string, sessionId: string, provider: string): Promise<void> {
  await getPool().query(
    `update users set kyc_session_id = $2, kyc_provider = $3, kyc_status = 'pending' where id = $1`,
    [userId, sessionId, provider],
  );
}

/** Resolve the user a webhook/decision belongs to, via the vendor session id. */
export async function getUserByKycSession(
  sessionId: string,
): Promise<{ id: string; kycTier: number; status: string } | null> {
  const { rows } = await getPool().query<{ id: string; kyc_tier: number; kyc_status: string }>(
    'select id, kyc_tier, kyc_status from users where kyc_session_id = $1',
    [sessionId],
  );
  return rows[0] ? { id: rows[0].id, kycTier: rows[0].kyc_tier, status: rows[0].kyc_status } : null;
}

/** Apply an approved verification: raise the tier (never lower it) and stamp approval. */
export async function setKycApproved(userId: string, tier: number): Promise<void> {
  await getPool().query(
    `update users set kyc_tier = greatest(kyc_tier, $2), kyc_status = 'approved', kyc_verified_at = now() where id = $1`,
    [userId, tier],
  );
}

/** Set a non-approved KYC status: 'in_review', terminal 'declined', or 'none' to clear a stale
 *  pending row (expired/abandoned vendor session) so the reconciler stops tracking it. */
export async function setKycStatus(userId: string, status: 'in_review' | 'declined' | 'none'): Promise<void> {
  await getPool().query('update users set kyc_status = $2 where id = $1', [userId, status]);
}

/** Pending vendor sessions (for the local decision-poll fallback when there's no public webhook URL). */
export async function getPendingKycSessions(): Promise<Array<{ id: string; sessionId: string; kycTier: number }>> {
  const { rows } = await getPool().query<{ id: string; kyc_session_id: string; kyc_tier: number }>(
    `select id, kyc_session_id, kyc_tier from users
      where kyc_status in ('pending', 'in_review') and kyc_session_id is not null`,
  );
  return rows.map((r) => ({ id: r.id, sessionId: r.kyc_session_id, kycTier: r.kyc_tier }));
}

/** Read a user's current KYC status (for /me). */
export async function getUserKycStatus(userId: string): Promise<string> {
  const { rows } = await getPool().query<{ kyc_status: string }>('select kyc_status from users where id = $1', [userId]);
  return rows[0]?.kyc_status ?? 'none';
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
  counterparty?: string;
}): Promise<void> {
  await getPool().query(
    `insert into risk_events (user_id, kind, amount_usdc, decision, score, reason, counterparty) values ($1,$2,$3,$4,$5,$6,$7)`,
    [input.userId, input.kind, input.amountUsd ?? null, input.decision, input.score, input.reason ?? null, input.counterparty ?? null],
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

export async function listNotifications(
  userId: string,
  limit = 30,
  cursor?: string,
): Promise<Page<Notification>> {
  const n = clampLimit(limit, 30, 100);
  const c = parseCursor(cursor);
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
       from notifications
      where user_id = $1
        and ($3::timestamptz is null or (created_at, id) < ($3::timestamptz, $4::uuid))
      order by created_at desc, id desc limit $2`,
    [userId, n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      meta: r.meta ?? undefined,
      read: r.read,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
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
  // Connect from the DEDICATED lock pool, not the query pool — fn's own queries use the query pool, so
  // holding this connection for the whole section can't deadlock against them (M6 audit H1).
  const client = await getLockPool().connect();
  let unlocked = false;
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [userId]);
    return await fn();
  } finally {
    try {
      await client.query('select pg_advisory_unlock(hashtext($1))', [userId]);
      unlocked = true;
    } catch {
      /* unlock failed */
    }
    // If the unlock didn't run, destroy the connection (release with an error) so the pool doesn't
    // recycle a session that still holds the advisory lock (poisoned-connection hazard, M6 audit M3).
    client.release(unlocked ? undefined : new Error('advisory unlock failed'));
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
      where t.id = $1 and t.kind = 'send'
        and not exists (select 1 from payment_requests pr where pr.transfer_id = t.id)`,
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

/* ---- v2 cross-chain bridge (docs/19): rail-agnostic transfer companion rows ---- */

export type BridgeState =
  | 'created'
  | 'source_submitted'
  | 'source_confirmed'
  | 'ready'
  | 'settling'
  | 'settled'
  | 'failed';

export interface BridgeTransferRow {
  id: string;
  transfer_id: string;
  user_id: string;
  rail: string;
  direction: 'out' | 'in';
  source_chain: string;
  source_domain: number;
  destination_chain: string;
  destination_domain: number;
  recipient: string;
  amount_usdc: string;
  fee_usdc: string;
  rail_fee_usdc: string;
  state: BridgeState;
  source_tx: string | null;
  settle_tx: string | null;
  rail_data: Record<string, unknown>;
  retry_count: number;
  next_attempt_at: Date | null;
  resolution: 'delayed' | 'needs_action' | null;
}

export async function insertBridgeTransfer(input: {
  transferId: string;
  userId: string;
  rail: string;
  direction: 'out' | 'in';
  sourceChain: string;
  sourceDomain: number;
  destinationChain: string;
  destinationDomain: number;
  recipient: string;
  amountUsd: number;
  feeUsd: number;
  railFeeUsd?: number;
  sourceTx?: string;
  state?: BridgeState;
  railData?: Record<string, unknown>;
}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into bridge_transfers
       (transfer_id, user_id, rail, direction, source_chain, source_domain,
        destination_chain, destination_domain, recipient, amount_usdc, fee_usdc, rail_fee_usdc,
        source_tx, state, rail_data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15::jsonb,'{}'::jsonb))
     returning id`,
    [
      input.transferId, input.userId, input.rail, input.direction,
      input.sourceChain, input.sourceDomain, input.destinationChain, input.destinationDomain,
      input.recipient, input.amountUsd, input.feeUsd, input.railFeeUsd ?? 0,
      input.sourceTx ?? null, input.state ?? 'created',
      input.railData ? JSON.stringify(input.railData) : null,
    ],
  );
  return rows[0].id;
}

export async function getBridgeByTransferId(transferId: string): Promise<BridgeTransferRow | null> {
  const { rows } = await getPool().query<BridgeTransferRow>(
    'select * from bridge_transfers where transfer_id = $1',
    [transferId],
  );
  return rows[0] ?? null;
}

/**
 * Atomic state claim (casOrderState pattern): advances only if the row is in one of `fromStates`.
 * `patch` sets columns; `railData` is MERGED into the jsonb (never replaced). Returns claim success.
 */
export async function casBridgeState(
  id: string,
  fromStates: BridgeState[],
  toState: BridgeState,
  patch?: {
    sourceTx?: string;
    settleTx?: string;
    retryCount?: number;
    nextAttemptAt?: Date | null;
    resolution?: 'delayed' | 'needs_action' | null;
    railData?: Record<string, unknown>;
  },
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update bridge_transfers
        set state = $3,
            updated_at = now(),
            settled_at = case when $3 = 'settled' then now() else settled_at end,
            source_tx = coalesce($4, source_tx),
            settle_tx = coalesce($5, settle_tx),
            retry_count = coalesce($6, retry_count),
            next_attempt_at = case when $7::boolean then $8 else next_attempt_at end,
            resolution = case when $9::boolean then $10 else resolution end,
            rail_data = rail_data || coalesce($11::jsonb, '{}'::jsonb)
      where id = $1 and state = any($2)`,
    [
      id, fromStates, toState,
      patch?.sourceTx ?? null, patch?.settleTx ?? null, patch?.retryCount ?? null,
      patch?.nextAttemptAt !== undefined, patch?.nextAttemptAt ?? null,
      patch?.resolution !== undefined, patch?.resolution ?? null,
      patch?.railData ? JSON.stringify(patch.railData) : null,
    ],
  );
  return (rowCount ?? 0) > 0;
}

/** Active rows due for a poller pass (next_attempt_at null or elapsed), oldest first. */
export async function listBridgeDue(limit = 20): Promise<BridgeTransferRow[]> {
  const { rows } = await getPool().query<BridgeTransferRow>(
    `select * from bridge_transfers
      where state not in ('settled','failed')
        and (next_attempt_at is null or next_attempt_at <= now())
      order by created_at asc
      limit $1`,
    [limit],
  );
  return rows;
}

export async function appendBridgeEvent(
  bridgeTransferId: string,
  fromState: string | null,
  toState: string,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await getPool().query(
    `insert into bridge_events (bridge_transfer_id, from_state, to_state, event, detail)
     values ($1,$2,$3,$4,$5)`,
    [bridgeTransferId, fromState, toState, event, detail ? JSON.stringify(detail) : null],
  );
}

/** Attach a PLATFORM-broadcast signature (inbound mint leg) — no owner scoping, unlike
 *  attachTransferSignature (users must never reach this path; route handlers don't call it). */
export async function attachPlatformTransferSignature(transferId: string, signature: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update transfers set signature = $2 where id = $1 and signature is null`,
    [transferId, signature],
  );
  return (rowCount ?? 0) > 0;
}

/** Companion-transfer status for bridge self-healing (poller crash between confirm and hook). */
export async function getTransferStatusById(transferId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ status: string }>('select status from transfers where id = $1', [transferId]);
  return rows[0]?.status ?? null;
}

/** Reconcile a bridge row's (and its companion transfer's) amount from the attested message. */
export async function reconcileBridgeAmount(bridgeId: string, transferId: string, amountUsd: number): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('update bridge_transfers set amount_usdc = $2, updated_at = now() where id = $1', [bridgeId, amountUsd]);
    await client.query('update transfers set amount_usdc = $2 where id = $1', [transferId, amountUsd]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Fail an unsigned companion transfer (inbound burn reverted — nothing will ever mint). */
export async function failUnsignedTransfer(transferId: string): Promise<void> {
  await getPool().query(`update transfers set status = 'failed' where id = $1 and signature is null`, [transferId]);
}

/** Upsert a per-chain wallet row (EVM deposit address capture; (user_id, chain) unique). */
export async function upsertWalletForChain(userId: string, chain: string, address: string): Promise<void> {
  await getPool().query(
    `insert into wallets (user_id, chain, address) values ($1, $2, $3)
     on conflict (user_id, chain) do update set address = excluded.address`,
    [userId, chain, address],
  );
}

/* ---- admin (read-only flow visibility) ---- */

// Wraps ORDER_SELECT as a subquery to bolt on the payer's handle without select-list surgery.
const ADMIN_ORDER_SELECT = `select x.*, u.handle as user_handle from (${ORDER_SELECT}) x join users u on u.id = x.user_id`;

type AdminOrderJoinRow = OrderJoinRow & { user_handle: string };

const toAdminOrder = (r: AdminOrderJoinRow, events?: OrderEvent[]): AdminOrder => ({
  ...toOrder(r, events),
  userHandle: r.user_handle,
});

/** All orders across all users, newest first — the operator's flow list. */
export async function listOrdersAdmin(limit = 50, cursor?: string): Promise<Page<AdminOrder>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<AdminOrderJoinRow>(
    `${ADMIN_ORDER_SELECT}
      where ($2::timestamptz is null or (x.created_at, x.id) < ($2::timestamptz, $3::uuid))
      order by x.created_at desc, x.id desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => toAdminOrder(r)),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}

/** One order, unscoped, with its full event timeline. */
export async function getOrderAdmin(orderId: string): Promise<AdminOrder | null> {
  const { rows } = await getPool().query<AdminOrderJoinRow>(`${ADMIN_ORDER_SELECT} where x.id = $1`, [orderId]);
  if (!rows[0]) return null;
  return toAdminOrder(rows[0], await listOrderEvents(orderId));
}

export async function listRoutingAttemptsAdmin(
  orderId: string,
): Promise<AdminOrderDetailResponse['routingAttempts']> {
  const { rows } = await getPool().query<{
    sequence: number;
    merchant_name: string;
    outcome: 'assigned' | 'released' | 'failed' | 'rerouted';
    reason: string | null;
    created_at: Date;
  }>(
    `select a.sequence, m.name as merchant_name, a.outcome, a.reason, a.created_at
       from order_routing_attempts a join merchants m on m.id = a.merchant_id
      where a.order_id = $1 order by a.sequence asc`,
    [orderId],
  );
  return rows.map((r) => ({
    sequence: r.sequence,
    merchantName: r.merchant_name,
    outcome: r.outcome,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function getDisputeForOrder(orderId: string): Promise<AdminOrderDetailResponse['dispute']> {
  const { rows } = await getPool().query<{
    id: string;
    reason: string | null;
    status: 'open' | 'resolved';
    resolution: 'upheld' | 'rejected' | null;
    created_at: Date;
    resolved_at: Date | null;
  }>(`select id, reason, status, resolution, created_at, resolved_at from disputes where order_id = $1`, [orderId]);
  const d = rows[0];
  if (!d) return null;
  return {
    id: d.id,
    reason: d.reason,
    status: d.status,
    resolution: d.resolution,
    createdAt: d.created_at.toISOString(),
    resolvedAt: d.resolved_at?.toISOString() ?? null,
  };
}

/** The order's escrow legs (fund + release), if created. */
export async function listOrderTransfersAdmin(orderId: string): Promise<AdminOrderDetailResponse['transfers']> {
  const { rows } = await getPool().query<{
    id: string;
    kind: string;
    status: 'pending' | 'confirmed' | 'failed';
    signature: string | null;
  }>(
    `select t.id, t.kind, t.status, t.signature
       from orders o join transfers t on t.id in (o.escrow_fund_transfer_id, o.escrow_release_transfer_id)
      where o.id = $1 order by t.created_at asc`,
    [orderId],
  );
  return rows;
}

/** One health read: order counts by state + everything currently needing a human. */
export async function adminOverview(): Promise<AdminOverviewResponse> {
  const pool = getPool();
  const [counts, disputes, stuck, risk, merchants, bridge] = await Promise.all([
    pool.query<{ state: OrderState; n: string }>(`select state, count(*) as n from orders group by state`),
    pool.query<{ id: string; order_id: string; merchant_name: string; amount_usdc: string; created_at: Date }>(
      `select d.id, d.order_id, m.name as merchant_name, o.amount_usdc, d.created_at
         from disputes d join merchants m on m.id = d.merchant_id join orders o on o.id = d.order_id
        where d.status = 'open' order by d.created_at desc limit 20`,
    ),
    pool.query<{
      id: string;
      state: OrderState;
      resolution: OrderResolution;
      handle: string;
      amount_usdc: string;
      updated_at: Date;
    }>(
      `select o.id, o.state, o.resolution, u.handle, o.amount_usdc, o.updated_at
         from orders o join users u on u.id = o.user_id
        where o.resolution is not null and o.state not in ('completed','refunded','failed')
        order by o.updated_at desc limit 20`,
    ),
    pool.query<{
      id: string;
      handle: string | null;
      kind: string;
      decision: 'review' | 'block';
      amount_usdc: string | null;
      reason: string | null;
      created_at: Date;
    }>(
      `select r.id, u.handle, r.kind, r.decision, r.amount_usdc, r.reason, r.created_at
         from risk_events r left join users u on u.id = r.user_id
        where r.decision <> 'allow' order by r.created_at desc limit 20`,
    ),
    pool.query<{ id: string; name: string; status: string; kyb_status: string }>(
      `select id, name, status, kyb_status from merchants
        where status = 'suspended' or kyb_status = 'pending' order by name`,
    ),
    pool.query<{ n: string }>(`select count(*) as n from bridge_transfers where state = 'failed'`),
  ]);
  const orderCounts: Partial<Record<OrderState, number>> = {};
  for (const r of counts.rows) orderCounts[r.state] = Number(r.n);
  return {
    orderCounts,
    openDisputes: disputes.rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      merchantName: r.merchant_name,
      amountUsdc: r.amount_usdc,
      createdAt: r.created_at.toISOString(),
    })),
    stuckOrders: stuck.rows.map((r) => ({
      id: r.id,
      state: r.state,
      resolution: r.resolution,
      userHandle: r.handle,
      amountUsdc: r.amount_usdc,
      updatedAt: r.updated_at.toISOString(),
    })),
    riskFlags: risk.rows.map((r) => ({
      id: r.id,
      userHandle: r.handle,
      kind: r.kind,
      decision: r.decision,
      amountUsdc: r.amount_usdc,
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
    })),
    merchantAlerts: merchants.rows.map((r) => ({ id: r.id, name: r.name, status: r.status, kybStatus: r.kyb_status })),
    failedBridgeCount: Number(bridge.rows[0].n),
  };
}

/* ---- admin ops (fpay-admin console): waitlist, users, merchants, risk, denylist, audit ---- */
// (addWaitlistEmail lives with the referral/landing block above — the public write; these are reads.)

export async function listWaitlist(): Promise<AdminWaitlistEntry[]> {
  const { rows } = await getPool().query<{
    email: string;
    city: string | null;
    created_at: Date;
    ref_code: string | null;
    referred_by: string | null;
    verified_at: Date | null;
  }>(`select email, city, created_at, ref_code, referred_by, verified_at from waitlist order by created_at desc`);
  return rows.map((r) => ({
    email: r.email,
    city: r.city,
    createdAt: r.created_at.toISOString(),
    code: r.ref_code,
    referredBy: r.referred_by,
    verifiedAt: r.verified_at ? r.verified_at.toISOString() : null,
  }));
}

/** Every account, newest first — the operator's user directory. */
export async function listUsersAdmin(limit = 50, cursor?: string): Promise<Page<AdminUser>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<{
    id: string;
    handle: string;
    display_name: string | null;
    email: string | null;
    kyc_tier: number;
    kyc_status: string;
    role: 'user' | 'merchant' | 'admin';
    created_at: Date;
  }>(
    `select id, handle, display_name, email, kyc_tier, kyc_status, role, created_at from users
      where ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::uuid))
      order by created_at desc, id desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      handle: r.handle,
      displayName: r.display_name,
      email: r.email,
      kycTier: r.kyc_tier,
      kycStatus: r.kyc_status,
      role: r.role,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}

/** All screened actions (every decision, not just flags — the overview already filters). */
export async function listRiskEventsAdmin(limit = 50, cursor?: string): Promise<Page<AdminRiskEvent>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<{
    id: string;
    handle: string | null;
    kind: string;
    decision: 'allow' | 'review' | 'block';
    score: number;
    amount_usdc: string | null;
    reason: string | null;
    counterparty: string | null;
    created_at: Date;
  }>(
    `select r.id, u.handle, r.kind, r.decision, r.score, r.amount_usdc, r.reason, r.counterparty, r.created_at
       from risk_events r left join users u on u.id = r.user_id
      where ($2::timestamptz is null or (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
      order by r.created_at desc, r.id desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      userHandle: r.handle,
      kind: r.kind,
      decision: r.decision,
      score: r.score,
      amountUsdc: r.amount_usdc,
      reason: r.reason,
      counterparty: r.counterparty,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}

/** Thin DTO mapper over listAllMerchants. Money columns pass THROUGH as the decimal strings pg
 *  hands back — numeric(20,6) already carries the scale, so no conversion is needed or wanted. */
export async function listMerchantsAdmin(): Promise<AdminMerchant[]> {
  const rows = await listAllMerchants();
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    status: m.status,
    kybStatus: m.kyb_status,
    payoutRail: m.payout_rail,
    bondUsdc: m.bond_usdc,
    floatUsdc: m.float_usdc,
    successRate: Number(m.success_rate),
    disputeRate: Number(m.dispute_rate),
    positiveRate: Number(m.positive_rate),
    real: m.user_id != null,
  }));
}

export async function listDenylist(): Promise<AdminDenylistEntry[]> {
  const { rows } = await getPool().query<{
    id: string;
    kind: 'address' | 'handle';
    value: string;
    reason: string | null;
    created_at: Date;
  }>(`select id, kind, value, reason, created_at from denylist order by created_at desc`);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    value: r.value,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
}

/** Returns the new row's id, or null if (kind, value) already exists (caller 409s). */
export async function addDenylistEntry(
  kind: 'address' | 'handle',
  value: string,
  reason?: string,
): Promise<string | null> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into denylist (kind, value, reason) values ($1, $2, $3) on conflict (kind, value) do nothing returning id`,
    [kind, value, reason ?? null],
  );
  return rows[0]?.id ?? null;
}

export async function removeDenylistEntry(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(`delete from denylist where id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Promote/demote an operator. Returns the role that actually landed, or null if there was no row.
 *
 * The `case` is the reason this isn't a bare update: role is a single column, so demoting an
 * operator who is ALSO a merchant would flatten them to 'user' and lose that fact. Merchant
 * capability really lives in the merchants table (requireMerchant reads that, not this), so the
 * column is informational — but informational and wrong is worse than absent, so a demote puts a
 * merchant back to 'merchant'.
 */
export async function setUserRole(
  userId: string,
  role: 'user' | 'admin',
): Promise<'user' | 'merchant' | 'admin' | null> {
  const { rows } = await getPool().query<{ role: 'user' | 'merchant' | 'admin' }>(
    `update users u set role = case
       when $2 = 'user' and exists (select 1 from merchants where user_id = u.id) then 'merchant'
       else $2 end
      where u.id = $1
      returning u.role`,
    [userId, role],
  );
  return rows[0]?.role ?? null;
}

/* ---- admin: invite codes ---- */

/** Every code, newest first, with both ends resolved to handles. Keyset tiebreak is `code` (text,
 *  the PK) rather than a uuid, so the cursor casts to ::text — otherwise identical to the other
 *  admin lists. */
export async function listInviteCodesAdmin(limit = 50, cursor?: string): Promise<Page<AdminInviteCode>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<{
    code: string;
    owner_handle: string | null;
    redeemed_by_handle: string | null;
    redeemed_at: Date | null;
    revoked_at: Date | null;
    note: string | null;
    created_at: Date;
  }>(
    `select i.code, o.handle as owner_handle, r.handle as redeemed_by_handle,
            i.redeemed_at, i.revoked_at, i.note, i.created_at
       from invite_codes i
       left join users o on o.id = i.owner_id
       left join users r on r.id = i.redeemed_by
      where ($2::timestamptz is null or (i.created_at, i.code) < ($2::timestamptz, $3::text))
      order by i.created_at desc, i.code desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      code: r.code,
      ownerHandle: r.owner_handle,
      // Revoked wins over redeemed: if an operator somehow revoked a burned code, the operator's
      // action is the more recent truth and the more useful thing to show.
      status: r.revoked_at ? 'revoked' : r.redeemed_at ? 'burned' : 'unused',
      redeemedByHandle: r.redeemed_by_handle,
      redeemedAt: r.redeemed_at?.toISOString() ?? null,
      revokedAt: r.revoked_at?.toISOString() ?? null,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.code}` : undefined,
  };
}

/** Mint from the console. `ownerId` null = a house code, constrained by nobody's allowance — the
 *  reason this endpoint exists at all. Returns what actually landed, not what was asked for. */
export async function mintInviteCodes(ownerId: string | null, count: number, note?: string): Promise<string[]> {
  return mintCodesFor(getPool(), ownerId, count, { note });
}

/** Revoke an unused code. False = it wasn't revokable (gone, burned, or already revoked); the
 *  caller re-reads inviteCodeStatus to say which, so the happy path stays one statement. */
export async function revokeInviteCode(code: string): Promise<boolean> {
  const res = await getPool().query(
    `update invite_codes set revoked_at = now()
      where code = $1 and redeemed_at is null and revoked_at is null`,
    [code],
  );
  return res.rowCount === 1;
}

/** Audit trail: every /admin/* mutation records who did what before responding. */
export async function insertAdminAction(input: {
  adminUserId: string;
  action: string;
  targetKind: string;
  targetId: string;
  note?: string;
}): Promise<void> {
  await getPool().query(
    `insert into admin_actions (admin_user_id, action, target_kind, target_id, note) values ($1, $2, $3, $4, $5)`,
    [input.adminUserId, input.action, input.targetKind, input.targetId, input.note ?? null],
  );
}

export async function listAdminActions(limit = 50, cursor?: string): Promise<Page<AdminAction>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<{
    id: string;
    handle: string;
    action: string;
    target_kind: string;
    target_id: string;
    note: string | null;
    created_at: Date;
  }>(
    `select a.id, u.handle, a.action, a.target_kind, a.target_id, a.note, a.created_at
       from admin_actions a join users u on u.id = a.admin_user_id
      where ($2::timestamptz is null or (a.created_at, a.id) < ($2::timestamptz, $3::uuid))
      order by a.created_at desc, a.id desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      adminHandle: r.handle,
      action: r.action,
      targetKind: r.target_kind,
      targetId: r.target_id,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}
