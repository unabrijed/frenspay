-- 0026: trips, circles and bill splitting (docs/04 §Trips, circles and splitting).
--
-- A group is a named roster. An expense (a transfers row) belongs to at most one group; deleting the
-- group makes its expenses personal again and leaves every share intact — shares are per expense,
-- not per group. A share IS a payment_requests row that names the expense it divides (`split_of`):
-- requester = the expense's payer, addressee = the friend, amount = their part. The payer's own part
-- is never stored — it is amount_usdc − Σ shares in (open, paid), enforced only inside the split
-- transaction under FOR UPDATE (queries.ts replaceShares).

create table if not exists groups (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id),
  name          text not null constraint groups_name_chk check (length(btrim(name)) between 1 and 40),
  created_at    timestamptz not null default now()
);

create table if not exists group_members (
  group_id   uuid not null references groups(id) on delete cascade,
  user_id    uuid not null references users(id),
  added_by   uuid not null references users(id),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists idx_group_members_user on group_members (user_id);

alter table transfers add column if not exists group_id uuid references groups(id) on delete set null;
create index if not exists idx_transfers_group on transfers (group_id) where group_id is not null;

alter table payment_requests add column if not exists split_of uuid references transfers(id);
create index if not exists idx_requests_split_of on payment_requests (split_of) where split_of is not null;

-- One transfer settles at most one request. Reuse of a transfer id across requests is now
-- unrepresentable — the DB's half of closing the unverified-transferId hole (markRequestPaid holds
-- the other half: the transfer must be the payer's, to the requester, for at least the amount).
create unique index if not exists uq_payment_requests_transfer
  on payment_requests (transfer_id) where transfer_id is not null;
