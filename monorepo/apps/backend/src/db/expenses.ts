import type { Pool, PoolClient } from 'pg';
import type { ApiExpense, ExpenseEdit, ExpensePayment } from '@fpay/shared';
import { allocateExpense, settleExpense } from '../lib/expenses';
import { BN } from '../lib/units';
import { canonicalHandle } from './queries';
import { getPool } from './pool';
import { operationalAddresses, isOperationalAddress } from '../services/solana';

type Db = Pool | PoolClient;
export class ExpenseError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function expenseTransaction<T>(fn: (db: PoolClient) => Promise<T>, existing?: PoolClient): Promise<T> {
  if (existing) return fn(existing);
  const db = await getPool().connect();
  try {
    await db.query('begin');
    const result = await fn(db);
    await db.query('commit');
    return result;
  } catch (e) {
    await db.query('rollback');
    throw e;
  } finally {
    db.release();
  }
}

interface ExpenseRow {
  id: string;
  creator_user_id: string;
  creator_handle: string;
  group_id: string | null;
  note: string;
  state: 'draft' | 'published';
  version: number;
  published_from_version: number | null;
  allocation_mode: 'equal' | 'custom';
  settlement_started: boolean;
  created_at: Date;
}
const expenseSelect = `select e.*,u.handle as creator_handle from expenses e join users u on u.id=e.creator_user_id`;
async function visibleExpense(db: Db, id: string, user: string): Promise<ExpenseRow> {
  const { rows } = await db.query<ExpenseRow>(
    `${expenseSelect} where e.id=$1 and
    (e.creator_user_id=$2 or exists(select 1 from expense_participants p where p.expense_id=e.id and p.user_id=$2)
      or exists(select 1 from group_members m where m.group_id=e.group_id and m.user_id=$2))`,
    [id, user],
  );
  if (!rows[0]) throw new ExpenseError('expense_not_found', 404);
  return rows[0];
}

// Escrow funding is not merchant payment: every payout leg must have completed. Transfers that
// settled requests, bridge funding, and operational-wallet deposits are never new expenses.
const paymentEligible = `(t.status='confirmed' and t.amount_usdc>0 and t.kind in ('send','escrow_fund','pay')
   and t.request_id is null
   and not exists(select 1 from payment_requests r where r.transfer_id=t.id)
   and not exists(select 1 from bridge_transfers b where b.transfer_id=t.id)
   and (t.kind='send' or (t.kind='pay' and exists(select 1 from merchant_payments mp where mp.transfer_id=t.id and mp.status='completed')) or (o.state='completed' and not exists(select 1 from orders leg where leg.group_id=o.id and leg.state<>'completed'))))`;
const paymentSelect = `select t.id,t.kind,t.from_user_id,u.handle,t.amount_usdc,t.to_address,t.created_at,
  to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at,
  coalesce(mp.merchant,q.payout_name,recipient.display_name,recipient.handle,t.note,'Payment') as payee_name,
  coalesce(mp.amount_fiat,q.amount_inr) as amount_fiat,coalesce(mp.currency,q.currency) as fiat_currency, ${paymentEligible} as eligible
  from transfers t join users u on u.id=t.from_user_id
  left join orders o on o.escrow_fund_transfer_id=t.id and o.group_id is null
  left join merchant_payments mp on mp.transfer_id=t.id
  left join quotes q on q.id=o.quote_id
  left join users recipient on recipient.id=t.to_user_id`;
interface PaymentRow {
  id: string;
  kind: string;
  from_user_id: string;
  handle: string;
  amount_usdc: string;
  to_address: string | null;
  created_at: Date;
  cursor_created_at?: string;
  payee_name: string;
  amount_fiat: string | null;
  fiat_currency: string | null;
  eligible: boolean;
}
function paymentDto(r: PaymentRow): ExpensePayment {
  return {
    transferId: r.id,
    userId: r.from_user_id,
    handle: r.handle,
    amountUsd: r.amount_usdc,
    payeeName: r.payee_name,
    createdAt: r.created_at.toISOString(),
    amountFiat: r.amount_fiat ?? undefined,
    fiatCurrency: r.fiat_currency ?? undefined,
    eligible: !!r.eligible && !(r.kind === 'send' && r.to_address && isOperationalAddress(r.to_address)),
  };
}
async function payments(db: Db, id: string): Promise<ExpensePayment[]> {
  return (
    await db.query<PaymentRow>(
      `${paymentSelect} join expense_payments ep on ep.transfer_id=t.id
    where ep.expense_id=$1 order by t.created_at,t.id`,
      [id],
    )
  ).rows.map(paymentDto);
}
export interface ExpensePage {
  cursor?: string;
  limit?: number;
}
function pageBoundary(cursor?: string): [string, string] | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(value[0]) ||
      !Number.isFinite(Date.parse(value[0])) ||
      new Date(value[0]).toISOString().slice(0, 19) !== value[0].slice(0, 19) ||
      typeof value[1] !== 'string' ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value[1])
    )
      throw new Error();
    return value as [string, string];
  } catch {
    throw new ExpenseError('invalid_cursor');
  }
}
function nextCursor(row: { created_at: Date; id: string; cursor_created_at?: string }): string {
  return Buffer.from(JSON.stringify([row.cursor_created_at ?? row.created_at.toISOString(), row.id])).toString(
    'base64url',
  );
}
export async function eligiblePaymentsPage(user: string, page: ExpensePage = {}) {
  const boundary = pageBoundary(page.cursor),
    limit = Math.min(100, Math.max(1, page.limit ?? 50));
  const rows = (
    await getPool().query<PaymentRow>(
      `${paymentSelect} where t.from_user_id=$1
    and ${paymentEligible} and (t.kind <> 'send' or t.to_address is null or not(t.to_address=any($2::text[])))
    and not exists(select 1 from expense_payments ep where ep.transfer_id=t.id)
    and ($3::timestamptz is null or (t.created_at,t.id)<($3::timestamptz,$4::uuid))
    order by t.created_at desc,t.id desc limit $5`,
      [user, operationalAddresses(), boundary?.[0] ?? null, boundary?.[1] ?? null, limit + 1],
    )
  ).rows;
  return {
    payments: rows.slice(0, limit).map(paymentDto),
    nextCursor: rows.length > limit ? nextCursor(rows[limit - 1]) : undefined,
  };
}
export async function eligiblePayments(user: string): Promise<ExpensePayment[]> {
  return (await eligiblePaymentsPage(user)).payments;
}

export async function getExpense(id: string, user: string, db?: PoolClient): Promise<ApiExpense> {
  if (!db) {
    const client = await getPool().connect();
    try {
      await client.query('begin isolation level repeatable read read only');
      const result = await getExpense(id, user, client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  const e = await visibleExpense(db, id, user);
  const linked = await payments(db, id);
  const { rows: people } = await db.query<{
    user_id: string;
    handle: string;
    name: string;
    share_usdc: string;
    trip_member: boolean;
  }>(
    `select p.*,u.handle,coalesce(u.display_name,u.handle) as name from expense_participants p
     join users u on u.id=p.user_id where p.expense_id=$1 order by (p.user_id=$2) desc,u.handle`,
    [id, e.creator_user_id],
  );
  const participants = people.map((p) => ({
    userId: p.user_id,
    handle: p.handle,
    name: p.name,
    shareUsd: p.share_usdc,
    tripMember: p.trip_member,
    paidUsd: linked
      .filter((x) => x.userId === p.user_id)
      .reduce((n, x) => n.plus(x.amountUsd), new BN(0))
      .toFixed(6),
  }));
  const { rows: requests } = await db.query<{
    id: string;
    from_user_id: string;
    to_user_id: string;
    from_handle: string;
    to_handle: string;
    amount_usdc: string;
    status: 'open' | 'paid' | 'cancelled';
    transfer_id: string | null;
    transfer_status: string | null;
  }>(
    `select r.*,debtor.handle as from_handle,creditor.handle as to_handle,t.status as transfer_status
     from payment_requests r join users debtor on debtor.id=r.to_user_id join users creditor on creditor.id=r.from_user_id
     left join transfers t on t.id=r.transfer_id where r.expense_id=$1 order by r.created_at,r.id`,
    [id],
  );
  const total = linked.reduce((n, p) => n.plus(p.amountUsd), new BN(0));
  const allocated = participants.reduce((n, p) => n.plus(p.shareUsd), new BN(0));
  const needsReview = linked.some((p) => !p.eligible) || !allocated.eq(total);
  return {
    id: e.id,
    creatorUserId: e.creator_user_id,
    creatorHandle: e.creator_handle,
    groupId: e.group_id ?? undefined,
    note: e.note,
    state: e.state,
    version: e.version,
    allocationMode: e.allocation_mode,
    locked: e.settlement_started,
    needsReview,
    canEdit: e.creator_user_id === user && !e.settlement_started && !needsReview,
    totalUsd: linked.reduce((n, p) => n.plus(p.amountUsd), new BN(0)).toFixed(6),
    memberCostUsd: participants
      .filter((p) => p.tripMember)
      .reduce((n, p) => n.plus(p.shareUsd), new BN(0))
      .toFixed(6),
    yourShareUsd: participants.find((p) => p.userId === user)?.shareUsd ?? '0.000000',
    createdAt: e.created_at.toISOString(),
    participants,
    payments: linked,
    settlements: requests.map((r) => ({
      id: r.id,
      fromUserId: r.to_user_id,
      toUserId: r.from_user_id,
      fromHandle: r.from_handle,
      toHandle: r.to_handle,
      amountUsd: r.amount_usdc,
      status:
        r.status === 'cancelled'
          ? 'cancelled'
          : r.transfer_status === 'pending'
            ? 'pending'
            : r.transfer_status === 'failed'
              ? 'open'
              : r.status,
      transferId: r.transfer_id ?? undefined,
      legacyRecorded: r.status === 'paid' && !r.transfer_id,
    })),
  };
}
export async function listExpensesPage(user: string, page: ExpensePage = {}) {
  const boundary = pageBoundary(page.cursor),
    limit = Math.min(100, Math.max(1, page.limit ?? 50));
  const { rows } = await getPool().query<{ id: string; created_at: Date; cursor_created_at: string }>(
    `select e.id,e.created_at,
    to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at from expenses e where
    (e.creator_user_id=$1 or exists(select 1 from expense_participants p where p.expense_id=e.id and p.user_id=$1))
    and ($2::timestamptz is null or (e.created_at,e.id)<($2::timestamptz,$3::uuid))
    order by e.created_at desc,e.id desc limit $4`,
    [user, boundary?.[0] ?? null, boundary?.[1] ?? null, limit + 1],
  );
  return {
    expenses: await Promise.all(rows.slice(0, limit).map((r) => getExpense(r.id, user))),
    nextCursor: rows.length > limit ? nextCursor(rows[limit - 1]) : undefined,
  };
}
export async function listExpenses(user: string): Promise<ApiExpense[]> {
  return (await listExpensesPage(user)).expenses;
}
async function assertGroup(db: Db, group: string | null | undefined, user: string) {
  if (
    group &&
    !(await db.query('select 1 from group_members where group_id=$1 and user_id=$2', [group, user])).rowCount
  )
    throw new ExpenseError('group_not_found', 404);
}
async function linkPayment(db: PoolClient, id: string, transfer: string, user: string) {
  // Lock the source too: concurrent bill creation/linking cannot claim the same transfer twice.
  await db.query('select id from transfers where id=$1 for update', [transfer]);
  const row = (await db.query<PaymentRow>(`${paymentSelect} where t.id=$1 and t.from_user_id=$2`, [transfer, user]))
    .rows[0];
  if (!row || !paymentDto(row).eligible) throw new ExpenseError('payment_not_eligible', 409);
  const prior = (
    await db.query<{ expense_id: string }>('select expense_id from expense_payments where transfer_id=$1', [transfer])
  ).rows[0];
  if (prior && prior.expense_id !== id) throw new ExpenseError('payment_already_linked', 409);
  await db.query(
    'insert into expense_payments(transfer_id,expense_id) values($1,$2) on conflict(transfer_id) do nothing',
    [transfer, id],
  );
  await db.query('update transfers set group_id=null where id=$1', [transfer]);
}
export async function createExpense(
  user: string,
  transfer: string,
  group?: string | null,
  db?: PoolClient,
): Promise<ApiExpense> {
  return expenseTransaction(async (db) => {
    // Serialize creates on the same source; returning an existing accessible bill is idempotent.
    await db.query('select id from transfers where id=$1 and from_user_id=$2 for update', [transfer, user]);
    const existing = (
      await db.query<{ expense_id: string }>('select expense_id from expense_payments where transfer_id=$1', [transfer])
    ).rows[0];
    if (existing) return getExpense(existing.expense_id, user, db);
    const source = (
      await db.query<{ note: string | null; group_id: string | null; created_at: Date }>(
        'select note,group_id,created_at from transfers where id=$1 and from_user_id=$2',
        [transfer, user],
      )
    ).rows[0];
    if (!source) throw new ExpenseError('transfer_not_found', 404);
    const groupId = group === undefined ? source.group_id : group;
    await assertGroup(db, groupId, user);
    await db.query('insert into expenses(id,creator_user_id,group_id,note,created_at) values($1,$2,$3,$4,$5)', [
      transfer,
      user,
      groupId,
      source.note?.trim().slice(0, 80) || 'Bill',
      source.created_at,
    ]);
    await linkPayment(db, transfer, transfer, user);
    await db.query(
      `insert into expense_participants(expense_id,user_id,share_usdc,trip_member)
      select $1,$2,t.amount_usdc,exists(select 1 from group_members where group_id=$3 and user_id=$2) from transfers t where t.id=$1`,
      [transfer, user, groupId],
    );
    return getExpense(transfer, user, db);
  }, db);
}
async function editable(
  db: PoolClient,
  id: string,
  user: string,
  version: number,
  creator = true,
): Promise<ApiExpense> {
  await db.query('select id from expenses where id=$1 for update', [id]);
  const e = await getExpense(id, user, db);
  if (creator && e.creatorUserId !== user) throw new ExpenseError('expense_not_found', 404);
  if (e.version !== version) throw new ExpenseError('expense_changed', 409);
  if (e.locked) throw new ExpenseError('expense_locked', 409);
  if (e.needsReview) throw new ExpenseError('expense_needs_review', 409);
  return e;
}
async function draft(db: PoolClient, id: string) {
  await db.query("update payment_requests set status='cancelled' where expense_id=$1 and status='open'", [id]);
  await db.query("update expenses set state='draft',version=version+1 where id=$1", [id]);
}
export async function editExpense(user: string, id: string, input: ExpenseEdit, db?: PoolClient): Promise<ApiExpense> {
  return expenseTransaction(async (db) => {
    const e = await editable(db, id, user, input.version);
    const group = input.groupId === undefined ? e.groupId : input.groupId;
    if (group !== e.groupId && !(group == null && e.groupId == null)) await assertGroup(db, group, user);
    const proposed = input.participants ?? e.participants.map((p) => ({ handle: p.handle, shareUsd: p.shareUsd }));
    if (!Array.isArray(proposed) || proposed.length < 1 || proposed.length > 21)
      throw new ExpenseError('invalid_participants');
    const handles = proposed.map((p) => canonicalHandle(p?.handle));
    if (handles.some((h) => !h) || new Set(handles).size !== handles.length)
      throw new ExpenseError('invalid_participants');
    const { rows: users } = await db.query<{ id: string; handle: string }>(
      "select id,handle from users where handle=any($1::text[]) and status='active'",
      [handles],
    );
    if (users.length !== proposed.length) throw new ExpenseError('unknown_handle', 404);
    const ids = users.map((u) => u.id);
    if (e.payments.some((p) => !ids.includes(p.userId))) throw new ExpenseError('contributor_required');
    const custom = new Map(
      users.map((u) => [u.id, proposed.find((p) => canonicalHandle(p.handle) === u.handle)?.shareUsd ?? '0']),
    );
    const equal = input.equal ?? (input.participants === undefined && e.allocationMode === 'equal');
    const allocations = allocateExpense(e.totalUsd, ids, e.creatorUserId, equal ? undefined : custom);
    const note = input.note === undefined ? e.note : input.note.trim();
    if (!note || note.length > 80) throw new ExpenseError('invalid_note');
    await db.query('update expenses set note=$2,group_id=$3,allocation_mode=$4 where id=$1', [
      id,
      note,
      group ?? null,
      equal ? 'equal' : 'custom',
    ]);
    await db.query('delete from expense_participants where expense_id=$1 and not(user_id=any($2::uuid[]))', [id, ids]);
    for (const u of users)
      await db.query(
        `insert into expense_participants(expense_id,user_id,share_usdc,trip_member)
      values($1,$2,$3,exists(select 1 from group_members where group_id=$4 and user_id=$2))
      on conflict(expense_id,user_id) do update set share_usdc=excluded.share_usdc,trip_member=case when $5 then excluded.trip_member else expense_participants.trip_member end`,
        [id, u.id, allocations.get(u.id), group ?? null, (group ?? null) !== (e.groupId ?? null)],
      );
    await draft(db, id);
    return getExpense(id, user, db);
  }, db);
}
export async function addExpensePayment(
  user: string,
  id: string,
  transfer: string,
  version: number,
): Promise<ApiExpense> {
  return expenseTransaction(async (db) => {
    const e = await editable(db, id, user, version, false);
    if (!e.participants.some((p) => p.userId === user)) throw new ExpenseError('expense_not_found', 404);
    if (e.payments.some((p) => p.transferId === transfer)) return e;
    await linkPayment(db, id, transfer, user);
    // Preserve all other allocations: a newly linked amount initially belongs to the initial
    // payer's remainder until the creator explicitly redistributes and publishes it.
    const amount = (await payments(db, id)).find((p) => p.transferId === transfer)!.amountUsd;
    await db.query('update expense_participants set share_usdc=share_usdc+$3 where expense_id=$1 and user_id=$2', [
      id,
      e.creatorUserId,
      amount,
    ]);
    await db.query("update expenses set allocation_mode='custom' where id=$1", [id]);
    await draft(db, id);
    return getExpense(id, user, db);
  });
}
export async function removeExpensePayment(
  user: string,
  id: string,
  transfer: string,
  version: number,
): Promise<ApiExpense> {
  return expenseTransaction(async (db) => {
    const e = await editable(db, id, user, version, false);
    if (transfer === id) throw new ExpenseError('initial_payment_required');
    const p = e.payments.find((p) => p.transferId === transfer);
    if (!p || p.userId !== user) throw new ExpenseError('payment_not_found', 404);
    const payer = e.participants.find((p) => p.userId === e.creatorUserId)!;
    if (new BN(payer.shareUsd).lt(p.amountUsd)) throw new ExpenseError('adjust_shares_first', 409);
    await db.query('delete from expense_payments where transfer_id=$1', [transfer]);
    await db.query('update expense_participants set share_usdc=share_usdc-$3 where expense_id=$1 and user_id=$2', [
      id,
      e.creatorUserId,
      p.amountUsd,
    ]);
    await db.query("update expenses set allocation_mode='custom' where id=$1", [id]);
    await draft(db, id);
    return getExpense(id, user, db);
  });
}
export async function publishExpense(user: string, id: string, version: number, db?: PoolClient): Promise<ApiExpense> {
  return expenseTransaction(async (db) => {
    const row = (await db.query<ExpenseRow>('select * from expenses where id=$1 for update', [id])).rows[0];
    if (!row || row.creator_user_id !== user) throw new ExpenseError('expense_not_found', 404);
    // A lost response can replay the original reviewed version even after settlement has started.
    if (row.state === 'published' && (row.published_from_version === version || row.version === version))
      return getExpense(id, user, db);
    const e = await editable(db, id, user, version);
    const edges = settleExpense(e.participants);
    for (const edge of edges) {
      const { rows } = await db.query<{ id: string }>(
        `insert into payment_requests(from_user_id,to_user_id,amount_usdc,note,expense_id)
        values($1,$2,$3,$4,$5) returning id`,
        [edge.toUserId, edge.fromUserId, edge.amountUsd, e.note, id],
      );
      const creditor = e.participants.find((p) => p.userId === edge.toUserId)!;
      await db.query(
        `insert into notifications(user_id,kind,title,body,meta) values($1,'share','Bill ready to settle',$2,$3::jsonb)`,
        [
          edge.fromUserId,
          `You owe ${creditor.handle} $${edge.amountUsd} for ${e.note}`,
          JSON.stringify({ expenseId: id, requestId: rows[0].id }),
        ],
      );
    }
    await db.query(
      "update expenses set state='published',published_from_version=version,version=version+1 where id=$1",
      [id],
    );
    return getExpense(id, user, db);
  }, db);
}

/** Re-run every confirmer tick, not only on a status transition: a process crash between the
 * transfer update and this update must heal without a second transfer or client request. */
export async function reconcileExpenseSettlements(): Promise<void> {
  await getPool().query(`with settled as (
    update payment_requests r set status='paid' from transfers t
    where r.expense_id is not null and r.status='open' and r.transfer_id=t.id and t.status='confirmed'
    returning r.id,r.from_user_id,r.to_user_id,r.amount_usdc,r.note,r.expense_id
  ) insert into notifications(user_id,kind,title,body,meta)
    select s.from_user_id,'request_paid','Bill payment received',
      u.handle || ' paid $' || s.amount_usdc::text || ' for ' || coalesce(s.note,'a bill'),
      jsonb_build_object('expenseId',s.expense_id,'requestId',s.id)
    from settled s join users u on u.id=s.to_user_id`);
  await getPool().query(`update payment_requests r set transfer_id=null from transfers t
    where r.expense_id is not null and r.status='open' and r.transfer_id=t.id and t.status='failed'`);
}

export async function expenseForTransfer(transfer: string, user: string, db?: PoolClient): Promise<ApiExpense | null> {
  const row = (
    await (db ?? getPool()).query<{ expense_id: string }>(
      'select expense_id from expense_payments where transfer_id=$1',
      [transfer],
    )
  ).rows[0];
  return row ? getExpense(row.expense_id, user, db) : null;
}

/** Called from the existing, screened transfer preparation path. Both the request reservation
 * and transfer intent are committed together, under the same expense lock used by edits. */
export async function reserveExpenseTransfer(input: {
  requestId: string;
  fromUserId: string;
  toUserId: string | null;
  fromAddress: string;
  toAddress: string;
  amountUsd: number;
  note?: string;
  chain?: string;
  idempotencyKey?: string;
}): Promise<{ id: string }> {
  return expenseTransaction(async (db) => {
    const parent = (
      await db.query<{ expense_id: string | null }>(
        'select expense_id from payment_requests where id=$1 and to_user_id=$2',
        [input.requestId, input.fromUserId],
      )
    ).rows[0];
    if (!parent?.expense_id) throw new ExpenseError('request_not_found', 404);
    await db.query('select id from expenses where id=$1 for update', [parent.expense_id]);
    const e = await getExpense(parent.expense_id, input.fromUserId, db);
    if (e.state !== 'published' || e.needsReview) throw new ExpenseError('expense_needs_review', 409);
    const r = (
      await db.query<{ status: string; from_user_id: string; amount_usdc: string; transfer_id: string | null }>(
        'select * from payment_requests where id=$1 and to_user_id=$2 for update',
        [input.requestId, input.fromUserId],
      )
    ).rows[0];
    if (!r || r.status !== 'open') throw new ExpenseError('request_not_open', 409);
    if (r.from_user_id !== input.toUserId || !new BN(r.amount_usdc).eq(input.amountUsd))
      throw new ExpenseError('request_mismatch', 409);
    if (r.transfer_id) {
      const t = (
        await db.query<{ id: string; status: string }>('select id,status from transfers where id=$1', [r.transfer_id])
      ).rows[0];
      if (t && t.status !== 'failed') throw new ExpenseError('request_payment_pending', 409);
    }
    const { rows } = await db.query<{ id: string }>(
      `insert into transfers(from_user_id,to_user_id,from_address,to_address,amount_usdc,kind,note,status,chain,idempotency_key,request_id,expense_memo_required)
      values($1,$2,$3,$4,$5,'send',$6,'pending',$7,$8,$9,true) returning id`,
      [
        input.fromUserId,
        input.toUserId,
        input.fromAddress,
        input.toAddress,
        r.amount_usdc,
        input.note ?? e.note,
        input.chain ?? 'solana',
        input.idempotencyKey ?? null,
        input.requestId,
      ],
    );
    await db.query('update payment_requests set transfer_id=$2 where id=$1', [input.requestId, rows[0].id]);
    await db.query('update expenses set settlement_started=true where id=$1', [e.id]);
    return rows[0];
  });
}

/** Monthly allocations count once, including shares not yet reimbursed. */
export async function expenseSpendSummary(user: string, filter: 'all' | 'personal' | 'trips', timeZone: string) {
  const { rows } = await getPool().query<{ spentUsd: string; yourShareUsd: string }>(
    `
    with month as (select date_trunc('month',now() at time zone $3) at time zone $3 as start),
    bills as (
      select e.id,e.created_at,e.state,p.share_usdc,
        case when p.trip_member then e.group_id else null end as group_id
      from expenses e join expense_participants p on p.expense_id=e.id and p.user_id=$1
      where not exists(select 1 from expense_payments ep join transfers t on t.id=ep.transfer_id
        left join orders o on o.escrow_fund_transfer_id=t.id and o.group_id is null
        where ep.expense_id=e.id and (not coalesce(${paymentEligible},false)
          or (t.kind='send' and t.to_address=any($4::text[]))))
      and (select sum(allocation.share_usdc) from expense_participants allocation where allocation.expense_id=e.id)
        = (select sum(source.amount_usdc) from expense_payments link join transfers source on source.id=link.transfer_id where link.expense_id=e.id)
    ), outgoing as (
      select t.amount_usdc,t.created_at,coalesce(b.group_id,sb.group_id,t.group_id) as group_id,
        source_bill.state as bill_state,(r.id is not null) as reimbursement
      from transfers t left join expense_payments ep on ep.transfer_id=t.id left join bills b on b.id=ep.expense_id
      left join expenses source_bill on source_bill.id=ep.expense_id
      left join payment_requests r on r.transfer_id=t.id and (r.expense_id is not null or r.split_of is not null)
      left join bills sb on sb.id=r.expense_id
      left join orders o on o.escrow_fund_transfer_id=t.id and o.group_id is null
      where t.from_user_id=$1 and t.status='confirmed' and t.kind in ('send','escrow_fund','pay')
        and (t.kind='send' or o.state='completed' or (t.kind='pay' and exists(select 1 from merchant_payments mp where mp.transfer_id=t.id and mp.status='completed')))
        and not exists(select 1 from bridge_transfers bridge where bridge.transfer_id=t.id)
    ) select
      coalesce((select sum(amount_usdc) from outgoing,month where created_at>=month.start
        and ($2='all' or ($2='trips' and group_id is not null) or ($2='personal' and group_id is null))),0)::text as "spentUsd",
      (coalesce((select sum(share_usdc) from bills,month where state='published' and created_at>=month.start
        and ($2='all' or ($2='trips' and group_id is not null) or ($2='personal' and group_id is null))),0)
      +coalesce((select sum(amount_usdc) from outgoing,month where bill_state is distinct from 'published'
        and not reimbursement and created_at>=month.start
        and ($2='all' or ($2='trips' and group_id is not null) or ($2='personal' and group_id is null))),0))::text as "yourShareUsd"`,
    [user, filter, timeZone, operationalAddresses()],
  );
  return rows[0];
}
