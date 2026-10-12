-- Bills are independent of payment transfers. No new rows represent outside/manual payments.
create table saved_friends (
  owner_user_id uuid not null references users(id),
  friend_user_id uuid not null references users(id),
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_user_id, friend_user_id),
  check (owner_user_id <> friend_user_id)
);
create table expenses (
  id uuid primary key references transfers(id),
  creator_user_id uuid not null references users(id),
  group_id uuid references groups(id) on delete set null,
  note text not null default 'Bill' check (length(note) between 1 and 80),
  state text not null default 'draft' check (state in ('draft', 'published')),
  version integer not null default 1,
  published_from_version integer,
  allocation_mode text not null default 'equal' check (allocation_mode in ('equal','custom')),
  settlement_started boolean not null default false,
  created_at timestamptz not null default now()
);
create index expenses_group_idx on expenses(group_id);
create table expense_participants (
  expense_id uuid not null references expenses(id),
  user_id uuid not null references users(id),
  share_usdc numeric(20,6) not null default 0 check (share_usdc >= 0),
  trip_member boolean not null default false,
  primary key (expense_id, user_id)
);
create index expense_participants_user_idx on expense_participants(user_id);
create table expense_payments (
  transfer_id uuid primary key references transfers(id),
  expense_id uuid not null references expenses(id),
  linked_at timestamptz not null default now()
);
create index expense_payments_expense_idx on expense_payments(expense_id);
alter table payment_requests add column expense_id uuid references expenses(id);
create index requests_expense_idx on payment_requests(expense_id);
-- A prepared reimbursement is reserved on the request before signing, and reconciled after
-- confirmation. A partial unique index also prevents different retries from reserving it twice.
create unique index transfers_live_request_idx on transfers(request_id)
  where request_id is not null and status <> 'failed';

-- Preserve the identity, requests, and historical manual ticks of every previous group/split.
insert into expenses (id, creator_user_id, group_id, note, state, settlement_started, created_at, allocation_mode)
select t.id, t.from_user_id, t.group_id, left(coalesce(nullif(btrim(t.note), ''), 'Bill'),80), 'published',
  exists(select 1 from payment_requests r where r.split_of=t.id and r.status='paid'), t.created_at, 'custom'
from transfers t where t.from_user_id is not null and t.kind in ('send','escrow_fund')
  and (t.group_id is not null or exists(select 1 from payment_requests r where r.split_of=t.id))
  and not exists(select 1 from payment_requests r where r.transfer_id=t.id and r.split_of is not null);
insert into expense_payments(transfer_id,expense_id) select id,id from expenses;
update transfers t set group_id=null from expense_payments ep where ep.transfer_id=t.id;
insert into expense_participants(expense_id,user_id,share_usdc,trip_member)
select e.id,e.creator_user_id,
  greatest(0,t.amount_usdc-coalesce((select sum(r.amount_usdc) from payment_requests r where r.split_of=e.id and r.status in ('open','paid')),0)),
  exists(select 1 from group_members m where m.group_id=e.group_id and m.user_id=e.creator_user_id)
from expenses e join transfers t on t.id=e.id;
insert into expense_participants(expense_id,user_id,share_usdc,trip_member)
select e.id,r.to_user_id,sum(r.amount_usdc),
  exists(select 1 from group_members m where m.group_id=e.group_id and m.user_id=r.to_user_id)
from expenses e join payment_requests r on r.split_of=e.id
where r.status in ('open','paid') and r.to_user_id is not null and r.to_user_id<>e.creator_user_id
group by e.id,r.to_user_id;
update payment_requests r set expense_id=e.id from expenses e where r.split_of=e.id;
-- Existing linked transfers remain linked. Pending/failed historical settlements must not be
-- shown as confirmed money, and can be retried without losing their original request identity.
update transfers t set request_id=r.id from payment_requests r
where r.transfer_id=t.id and r.expense_id is not null;
update payment_requests r set status='open' from transfers t
where r.transfer_id=t.id and r.expense_id is not null and t.status <> 'confirmed' and r.status='paid';

-- Recovery never infers non-payment from a missing client signature. The cursor lets the worker
-- scan all activity since preparation without assuming a fixed recent-transaction limit.
alter table transfers add column expense_recovery_before text;
alter table transfers add column expense_memo_required boolean not null default false;
