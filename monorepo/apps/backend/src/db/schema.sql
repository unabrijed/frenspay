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
  kind         text not null default 'send' constraint transfers_kind_chk check (kind in ('send','add','pay','escrow_fund','escrow_release')),
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

-- M1: stablecoin on/off-ramp order lifecycle (stablecoin-onofframp-architecture.pdf).
-- Simulated merchant/LP network. The M3 routing engine ranks on these signals;
-- sim_behavior drives failure-injection in the simulated-merchant worker.
create table if not exists merchants (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  payout_rail         text not null default 'UPI' constraint merchants_rail_chk check (payout_rail in ('UPI','Pix','bank')),
  status              text not null default 'online' constraint merchants_status_chk check (status in ('online','offline','suspended')),
  treasury_address    text not null,                  -- devnet address the released USDC settles to
  success_rate        numeric(5, 4) not null default 0.99,
  avg_completion_secs integer not null default 120,
  spread_bps          integer not null default 50,    -- 50 = 0.50% taken off the mid rate
  float_usdc          numeric(20, 6) not null default 100000,
  dispute_rate        numeric(5, 4) not null default 0.005,  -- M3 ranking signal: fraction of orders disputed
  -- M4: lifecycle + accountability. base_* are the seed priors the recompute smooths live signals toward.
  kyb_status          text not null default 'approved' constraint merchants_kyb_chk check (kyb_status in ('pending','approved','rejected')),
  bond_usdc           numeric(20, 6) not null default 5000,
  base_success_rate        numeric(5, 4) not null default 0.99,
  base_avg_completion_secs integer not null default 120,
  base_dispute_rate        numeric(5, 4) not null default 0.005,
  sim_behavior        text not null default 'happy' constraint merchants_sim_chk check (sim_behavior in ('happy','slow','no_receipt','timeout')),
  created_at          timestamptz not null default now()
);

-- A quote locked for 45s. amount_inr = fiat leg, amount_usdc = crypto leg debited into escrow.
create table if not exists quotes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  merchant_id     uuid references merchants(id),
  direction       text not null default 'spend' constraint quotes_direction_chk check (direction in ('spend','cash_out')),
  amount_inr      numeric(20, 2) not null,
  amount_usdc     numeric(20, 6) not null,
  rate            numeric(20, 6) not null,            -- INR per 1 USDC, after merchant spread
  fee_inr         numeric(20, 2) not null default 0,
  network_fee_inr numeric(20, 2) not null default 0,
  eta_min_secs    integer not null,
  eta_max_secs    integer not null,
  payout_method   text not null default 'UPI' constraint quotes_payout_chk check (payout_method in ('UPI','Pix','bank')),
  route_quality   text not null default 'high' constraint quotes_route_chk check (route_quality in ('high','medium','low')),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);

-- The order state machine. `state` is the 7-step happy path + terminal refunded/failed; `resolution`
-- overlays a transient "what's happening" state (delayed/needs_action/under_review). `expires_at` is
-- the current-state deadline the worker escalates on.
create table if not exists orders (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references users(id) on delete cascade,
  quote_id                   uuid not null references quotes(id),
  merchant_id                uuid references merchants(id),
  amount_usdc                numeric(20, 6) not null,
  reference_code             text unique not null,
  state                      text not null default 'quote_locked' constraint orders_state_chk
                               check (state in ('quote_locked','pay_instructions','waiting_payment','payment_detected','merchant_confirms','funds_released','completed','refunded','failed')),
  resolution                 text constraint orders_resolution_chk check (resolution in ('delayed','needs_action','under_review')),
  escrow_fund_transfer_id    uuid references transfers(id),
  escrow_release_transfer_id uuid references transfers(id),
  note                       text,
  expires_at                 timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- Append-only transition log powering the live order timeline.
create table if not exists order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  from_state text,
  to_state   text not null,
  event      text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

-- M3 routing engine: per-order assignment + reroute audit log. Doubles as the "already tried" set for
-- auto-failover and the observability trail (which LP, why, what happened). sequence 1 = initial.
create table if not exists order_routing_attempts (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  merchant_id uuid not null references merchants(id),
  sequence    integer not null,
  outcome     text not null default 'assigned'
                constraint ora_outcome_chk check (outcome in ('assigned','released','failed','rerouted')),
  reason      text,
  created_at  timestamptz not null default now(),
  unique (order_id, sequence)
);

-- M4: dispute records. Resolved 'upheld' (for the user) draws down the merchant's bond and feeds the
-- recomputed dispute_rate; 'rejected' clears the merchant. The user opens one on a completed order.
create table if not exists disputes (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  merchant_id uuid not null references merchants(id),
  reason      text,
  status      text not null default 'open' constraint disputes_status_chk check (status in ('open','resolved')),
  resolution  text constraint disputes_resolution_chk check (resolution in ('upheld','rejected')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_transfers_from_user on transfers (from_user_id, created_at desc);
create index if not exists idx_transfers_to_user   on transfers (to_user_id, created_at desc);
create index if not exists idx_requests_to_user    on payment_requests (to_user_id, created_at desc);
create index if not exists idx_requests_from_user  on payment_requests (from_user_id, created_at desc);
create index if not exists idx_orders_user         on orders (user_id, created_at desc);
create index if not exists idx_orders_state        on orders (state, expires_at);
create index if not exists idx_order_events_order  on order_events (order_id, created_at);
create index if not exists idx_routing_attempts    on order_routing_attempts (order_id, sequence);
create index if not exists idx_disputes_merchant   on disputes (merchant_id);
-- One dispute per order (prevents bond over-draw + dispute_rate corruption from repeated disputes).
create unique index if not exists uq_disputes_order on disputes (order_id);
create index if not exists idx_quotes_user         on quotes (user_id, created_at desc);

-- Backfill the CHECK constraints on databases created before they were added (the table
-- definitions above only apply them on a fresh `create table`). Idempotent.
do $$ begin
  -- transfers.kind was widened in M1 to carry escrow movement — drop+recreate so pre-M1 DBs accept it.
  alter table transfers drop constraint if exists transfers_kind_chk;
  alter table transfers add constraint transfers_kind_chk check (kind in ('send','add','pay','escrow_fund','escrow_release'));
  if not exists (select 1 from pg_constraint where conname = 'transfers_status_chk') then
    alter table transfers add constraint transfers_status_chk check (status in ('pending','confirmed','failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_requests_status_chk') then
    alter table payment_requests add constraint payment_requests_status_chk check (status in ('open','paid','cancelled'));
  end if;
  -- M3: dispute_rate added to merchants after the table may already exist on older DBs.
  alter table merchants add column if not exists dispute_rate numeric(5, 4) not null default 0.005;
  -- M4: lifecycle + accountability columns; widen status to allow 'suspended'.
  alter table merchants add column if not exists kyb_status text not null default 'approved';
  alter table merchants add column if not exists bond_usdc numeric(20, 6) not null default 5000;
  alter table merchants add column if not exists base_success_rate numeric(5, 4) not null default 0.99;
  alter table merchants add column if not exists base_avg_completion_secs integer not null default 120;
  alter table merchants add column if not exists base_dispute_rate numeric(5, 4) not null default 0.005;
  alter table merchants drop constraint if exists merchants_status_chk;
  alter table merchants add constraint merchants_status_chk check (status in ('online','offline','suspended'));
  if not exists (select 1 from pg_constraint where conname = 'merchants_kyb_chk') then
    alter table merchants add constraint merchants_kyb_chk check (kyb_status in ('pending','approved','rejected'));
  end if;
end $$;
