-- Phase 1 schema (backend-architecture.md §3). Self-custodial USDC wallet + P2P.
-- Access control is enforced in the API layer; these tables have no row-level security.

create extension if not exists "pgcrypto";

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  privy_did     text unique not null,
  handle        text unique not null,
  display_name  text,
  email         text,
  phone         text,
  created_at    timestamptz not null default now()
);

create table if not exists wallets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  chain       text not null default 'solana',
  address     text unique not null,
  created_at  timestamptz not null default now()
);

create table if not exists transfers (
  id           uuid primary key default gen_random_uuid(),
  signature    text unique,
  from_address text,
  to_address   text,
  from_user_id uuid references users(id),
  to_user_id   uuid references users(id),
  amount_usdc  numeric(20, 6) not null,
  kind         text not null default 'send' constraint transfers_kind_chk check (kind in ('send','add','pay')),
  note         text,
  status       text not null default 'pending' constraint transfers_status_chk check (status in ('pending','confirmed','failed')),
  request_id   uuid,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

create table if not exists payment_requests (
  id           uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references users(id),
  to_user_id   uuid references users(id),
  amount_usdc  numeric(20, 6) not null,
  note         text,
  status       text not null default 'open' constraint payment_requests_status_chk check (status in ('open','paid','cancelled')),
  transfer_id  uuid references transfers(id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_transfers_from_user on transfers (from_user_id, created_at desc);
create index if not exists idx_transfers_to_user   on transfers (to_user_id, created_at desc);
create index if not exists idx_requests_to_user    on payment_requests (to_user_id, created_at desc);
create index if not exists idx_requests_from_user  on payment_requests (from_user_id, created_at desc);

-- Backfill the CHECK constraints on databases created before they were added (the table
-- definitions above only apply them on a fresh `create table`). Idempotent.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transfers_kind_chk') then
    alter table transfers add constraint transfers_kind_chk check (kind in ('send','add','pay'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transfers_status_chk') then
    alter table transfers add constraint transfers_status_chk check (status in ('pending','confirmed','failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_requests_status_chk') then
    alter table payment_requests add constraint payment_requests_status_chk check (status in ('open','paid','cancelled'));
  end if;
end $$;
