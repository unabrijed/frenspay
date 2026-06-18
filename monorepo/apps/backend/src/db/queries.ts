// queries.ts — typed data access over the lazy pg pool (db/pool.ts).
// Maps rows to the @pay/shared wire DTOs. Phase 1 is USDC-only, so no rupee column.
import type { ApiPaymentRequest, ApiTxn, Friend } from '@pay/shared';

import { getPool } from './pool';

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

/** Upsert the user (by Privy DID) + their wallet. Called by /auth/sync after login. */
export async function upsertUserByPrivyDid(input: {
  privyDid: string;
  handle: string;
  displayName?: string;
  walletAddress: string;
}): Promise<UserRow> {
  const pool = getPool();
  const { rows } = await pool.query<UserRow>(
    `insert into users (privy_did, handle, display_name)
     values ($1, $2, $3)
     on conflict (privy_did) do update set handle = excluded.handle, display_name = excluded.display_name
     returning *`,
    [input.privyDid, input.handle, input.displayName ?? null],
  );
  const user = rows[0];
  await pool.query(
    `insert into wallets (user_id, address) values ($1, $2)
     on conflict (address) do nothing`,
    [user.id, input.walletAddress],
  );
  return user;
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

/* ---- transfers (M1 prepare/submit, M2 confirmation) ---- */

export async function createPendingTransfer(input: {
  fromUserId: string;
  toUserId: string | null;
  fromAddress: string;
  toAddress: string;
  amountUsd: number;
  kind?: 'send' | 'add' | 'pay';
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

export async function attachTransferSignature(transferId: string, signature: string): Promise<void> {
  await getPool().query('update transfers set signature = $2 where id = $1', [transferId, signature]);
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
