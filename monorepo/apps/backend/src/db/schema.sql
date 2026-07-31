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
  kyc_tier      integer not null default 1,  -- M5: 0 restricted · 1 basic/P2P · 2 verified/merchant · 3 enhanced
  created_at    timestamptz not null default now()
);

-- M7: real-vendor KYC. The tier (above) is what gates money movement; these columns track the
-- vendor verification lifecycle. Idempotent ALTERs so existing DBs pick them up on boot (init.ts).
alter table users add column if not exists kyc_status     text not null default 'none'; -- none|pending|in_review|approved|declined
alter table users add column if not exists kyc_provider   text;
alter table users add column if not exists kyc_session_id text;
alter table users add column if not exists kyc_verified_at timestamptz;
-- Webhook/poll correlates the vendor session back to the user; unique so a session maps to one user.
create unique index if not exists users_kyc_session_id_idx on users(kyc_session_id);

create table if not exists wallets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  chain       text not null default 'solana',
  address     text unique not null,
  created_at  timestamptz not null default now()
);

-- One wallet per user per chain; upserts target this so a re-sync updates the address in place
-- instead of accumulating rows (duplicate rows made getWalletForUser pick nondeterministically).
create unique index if not exists uq_wallets_user_chain on wallets (user_id, chain);

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
  -- Network the transfer settles on. 'solana' today; the confirmer must filter on this before any
  -- non-Solana rail lands (a foreign signature in the Solana poller = permanent-pending zombie row).
  chain        text not null default 'solana',
  -- Client-generated prepare dedupe key (double-tap / manual-retry guard). Unique per sender.
  idempotency_key text,
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

-- M5: sanctions/denylist (simulated) — addresses or handles that must be blocked from money movement.
create table if not exists denylist (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null constraint denylist_kind_chk check (kind in ('address','handle')),
  value      text not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (kind, value)
);

-- M5: risk/fraud audit — one row per screened money-movement action (decision + score + reason).
create table if not exists risk_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade,
  kind        text not null,                 -- send | cash_out | onboarding
  amount_usdc numeric(20, 6),
  decision    text not null default 'allow' constraint risk_decision_chk check (decision in ('allow','review','block')),
  score       integer not null default 0,
  reason      text,
  -- Who the money was going to (handle or raw address). For external sends this is the whole
  -- point of the audit row — a screened/blocked decision is meaningless without the counterparty.
  counterparty text,
  created_at  timestamptz not null default now()
);

-- M6: in-app notifications (DB-backed; real push/webhooks deferred to M7).
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null,                 -- payment_sent | received | refunded | request_paid | kyc_upgraded
  title      text not null,
  body       text,
  meta       jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
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
create index if not exists idx_risk_events_user    on risk_events (user_id, created_at desc);
create index if not exists idx_notifications_user  on notifications (user_id, created_at desc);
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
  -- M5: KYC tier on existing user rows.
  alter table users add column if not exists kyc_tier integer not null default 1;
  -- Direct-address send (docs/16): chain identity + prepare idempotency + risk counterparty
  -- on existing DBs.
  alter table transfers add column if not exists chain text not null default 'solana';
  alter table transfers add column if not exists idempotency_key text;
  alter table risk_events add column if not exists counterparty text;
end $$;

-- After the do-block so the columns exist on pre-existing DBs before the index is built.
create unique index if not exists uq_transfers_idempotency
  on transfers (from_user_id, idempotency_key) where idempotency_key is not null;

-- UPI-style aliases (docs/16 follow-up): handle is the payment ID (canonical '@' + [a-z0-9_.]{3,30},
-- enforced server-side at /auth/sync); users.phone is the pay-by-phone mapper entry — E.164,
-- present iff the user opted in (enrollment IS the consent, like NPCI's numeric mapper).
do $$ begin
  -- Legacy canonicalization: ensure the leading '@', then lowercase. Case-collisions are skipped
  -- to preserve the unique constraint (expected 0; they stay exact-match-only until resolved).
  update users set handle = '@' || handle where handle not like '@%';
  update users u set handle = lower(u.handle)
   where u.handle <> lower(u.handle)
     and not exists (select 1 from users v where v.id <> u.id and v.handle = lower(u.handle));
end $$;

-- One account per phone. Partial so non-enrolled rows (null) don't collide.
create unique index if not exists uq_users_phone on users (phone) where phone is not null;

-- Dialing-default country (ISO 3166-1 alpha-2), best-effort. Write strength: browser locale
-- fills only when NULL (/auth/sync coalesce); verified-phone-derived and manual Settings picks
-- overwrite via /me/country. A UX default only — never a compliance/identity attribute.
alter table users add column if not exists country text;

-- v2 cross-chain bridge (docs/19). Rail-agnostic: `rail` names the protocol implementation
-- (cctp_standard / cctp_fast / future), rail_data holds rail-specific artifacts (CCTP: message
-- hex, attestation, nonce) so new rails need no schema change. Companion to ONE transfers row —
-- always the SOLANA leg (outbound: the burn, kind='send'; inbound: the mint, kind='add') so the
-- existing chain='solana' confirmer and the send daily-cap work unchanged. Generic states:
--   created -> source_submitted -> source_confirmed -> ready -> settling -> settled / failed
-- (CCTP mapping: attested=ready, minting=settling, minted=settled.) Post-source-confirmed states
-- NEVER expire: once burned, the attestation is permissionless + replayable — funds can be
-- delayed, never stranded.
create table if not exists bridge_transfers (
  id                 uuid primary key default gen_random_uuid(),
  transfer_id        uuid unique not null references transfers(id),
  user_id            uuid not null references users(id),
  rail               text not null,
  direction          text not null default 'out' constraint bridge_direction_chk check (direction in ('out','in')),
  source_chain       text not null,
  source_domain      integer not null,
  destination_chain  text not null,
  destination_domain integer not null,
  recipient          text not null,            -- lowercase 0x (out) or Solana ATA (in)
  amount_usdc        numeric(20,6) not null,
  fee_usdc           numeric(20,6) not null default 0,
  rail_fee_usdc      numeric(20,6) not null default 0,
  state              text not null default 'created' constraint bridge_state_chk
    check (state in ('created','source_submitted','source_confirmed','ready','settling','settled','failed')),
  source_tx          text,
  settle_tx          text,
  rail_data          jsonb not null default '{}'::jsonb,
  retry_count        integer not null default 0,
  next_attempt_at    timestamptz,
  resolution         text constraint bridge_resolution_chk check (resolution in ('delayed','needs_action')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  settled_at         timestamptz
);
create index if not exists idx_bridge_active on bridge_transfers (state, next_attempt_at)
  where state not in ('settled','failed');
-- Dedupes re-reported inbound burns (source_tx = the EVM burn hash reported by the client).
create unique index if not exists uq_bridge_source_tx on bridge_transfers (source_tx)
  where source_tx is not null;

create table if not exists bridge_events (
  id                 uuid primary key default gen_random_uuid(),
  bridge_transfer_id uuid not null references bridge_transfers(id) on delete cascade,
  from_state         text,
  to_state           text not null,
  event              text not null,
  detail             jsonb,
  created_at         timestamptz not null default now()
);

-- Real (human) merchants. Until now every LP was a seeded simulation driven by `sim_behavior`; a
-- merchant with a `user_id` is a real person who logs in, sees the assigned order with the payee's
-- actual UPI ID, pays the fiat leg out-of-band, and reports it. `payout_destination` is the missing
-- half of the off-ramp: `payout_method` has always named the RAIL ('UPI'), never WHO gets the money.
do $$ begin
  -- Who actually receives the fiat. Lives on quotes (not orders) because the merchant's order view
  -- already joins quotes for amount_inr — orders only carries amount_usdc.
  alter table quotes add column if not exists payout_destination text;   -- e.g. 'shop@okhdfcbank'
  alter table quotes add column if not exists payout_name        text;   -- payee name shown pre-pay

  -- The real LP's claim that it paid the fiat leg: a hand-entered UTR + when the dispute window
  -- opened. Deliberately NOT a new order state — the order stays `payment_detected` (money secured,
  -- LP holds the obligation) and this is data about it. A `payout_claimed` state would have had to
  -- be threaded through orders_state_chk, the shared OrderState union, OrderTracking's step index,
  -- both casOrderState call sites AND committedFloatByMerchant's state list — miss that last one and
  -- the LP's float silently stops being committed mid-window, so routing over-commits it.
  alter table orders add column if not exists payout_utr        text;
  alter table orders add column if not exists payout_claimed_at timestamptz;

  -- A merchant is now a real logged-in user. Nullable: the seeded sim LPs keep user_id null.
  alter table merchants add column if not exists user_id uuid references users(id);
  -- sim_behavior NULL now means "a REAL merchant the sim worker must not drive". Without dropping
  -- the 'happy' default, every merchant created via /merchants/apply would inherit it and the sim
  -- worker would auto-release the escrow ~4s after payment_detected — the human would never even
  -- see the order. merchants_sim_chk needs no change: a NULL in `in (...)` is unknown, and CHECK
  -- only rejects FALSE. Both DROPs are idempotent, and seed.ts lists sim_behavior explicitly.
  alter table merchants alter column sim_behavior drop not null;
  alter table merchants alter column sim_behavior drop default;
end $$;

-- One merchant account per user. Partial so the seeded sim LPs (user_id null) don't collide.
create unique index if not exists uq_merchants_user on merchants (user_id) where user_id is not null;

-- Merchant legitimacy: one-tap payer feedback (👍/👎) and the smoothed signal it feeds. A column on
-- orders, not a table — one feedback per order mirrors one dispute per order (uq_disputes_order).
-- The smoothing prior is a code constant (merchantStats.ts), so no base_positive_rate column.
do $$ begin
  alter table orders    add column if not exists feedback_up   boolean;              -- null = not answered
  alter table merchants add column if not exists positive_rate numeric(5,4) not null default 0.9;
end $$;

-- Admin flow-visibility: coarse role for the read-only admin viewer. Merchant CAPABILITY stays
-- derived from merchants.user_id (requireMerchant needs the row); role='merchant' is an
-- informational mirror set at apply-time. 'admin' is only ever set by hand or the dev seed:
--   update users set role='admin' where handle='@you';
alter table users add column if not exists role text not null default 'user'
  constraint users_role_chk check (role in ('user','merchant','admin'));
-- Backfill existing real merchants; never demotes an admin. Idempotent (runs on every db:init).
update users set role = 'merchant'
  where role = 'user' and id in (select user_id from merchants where user_id is not null);

-- F-list waitlist (landing-page signups). Unauthenticated writes → email is the PK so a re-submit
-- is a no-op (the insert uses on conflict do nothing). No user FK — these people don't have
-- accounts yet. city = which demo-rate corridor the visitor had selected (marketing signal).
create table if not exists waitlist (
  email      text primary key,
  city       text,
  created_at timestamptz not null default now()
);
-- Referral loop + double opt-in, layered on the original three columns.
--   ref_code    = this member's OWN share code. Derived HMAC(WAITLIST_SECRET,'ref:'||email) in app
--                 code, so it is stable across re-submits and costs no storage to mint. Null on rows
--                 written before this existed (and while WAITLIST_SECRET is unset); backfilled by
--                 the coalesce in addWaitlistEmail the next time that address is submitted.
--   referred_by = who brought them: EITHER an app user's '@handle' OR another member's ref_code.
--                 Both are opaque strings and '@' disambiguates, so one column serves both loops
--                 with no join and no second FK. First attribution wins, never rewritten (same rule
--                 as users.referred_by).
-- ponytail: no FK on referred_by, so renaming a handle orphans old attribution. Acceptable for a
-- marketing queue; promote to a real FK if referral credit ever pays out money.
alter table waitlist add column if not exists ref_code    text;
alter table waitlist add column if not exists referred_by text;
alter table waitlist add column if not exists verified_at timestamptz;
create unique index if not exists idx_waitlist_ref_code    on waitlist (ref_code);
create index        if not exists idx_waitlist_referred_by on waitlist (referred_by);

-- Admin audit trail: one row per admin WRITE action (who did what to which target). Written by
-- every /admin/* mutation; target_id is text (uuid or 'kind:value' for denylist) so one table
-- covers all target kinds.
create table if not exists admin_actions (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references users(id),
  action        text not null,   -- kyb_approve|kyb_reject|merchant_suspend|merchant_reinstate|dispute_resolve|denylist_add|denylist_remove
  target_kind   text not null,   -- merchant | dispute | denylist
  target_id     text not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_admin_actions_created on admin_actions (created_at desc);

-- Invite-only referrals: the code IS the referrer's handle; used = count(referred_by). The gate
-- lives in /auth/sync and fires only when the sync CREATES the row, so pre-gate users (referred_by
-- null) are grandfathered for free. Per-user overrides by hand, like role:
--   update users set referral_limit = 10 where handle='@you';
alter table users add column if not exists referral_limit integer not null default 3;
alter table users add column if not exists referred_by uuid references users(id);
create index if not exists idx_users_referred_by on users (referred_by);
