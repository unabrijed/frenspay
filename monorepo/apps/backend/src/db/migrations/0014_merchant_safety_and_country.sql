-- 0014_merchant_safety_and_country — country-scope the LP pool, and make the bond actually gate
-- routing instead of being reconciled by a background job 80 seconds later.
--
-- THE HOLE THIS CLOSES. `setMerchantKyb('approve')` sets status='online' and listRoutableMerchants
-- filters on nothing but (status, kyb_status) — there was no bond check anywhere in the routing
-- path. insertMerchantApplication inserts bond_usdc = 0. So an approved LP with ZERO stake was
-- routable, and stayed routable until recomputeMerchantStats ran (every 10th confirmer tick, ~80s)
-- and suspended them. Between approval and that tick, a real order could be escrowed against an LP
-- with no skin in the game at all. The floor now lives in the SELECT that picks LPs, which is the
-- only place it can't be raced.
--
-- WHY COUNTRY, when rail already implies it. Today it's redundant: UPI is India, QRIS is Indonesia.
-- It stops being redundant the moment a rail exists in more than one country — 'bank' already does
-- in the real world, and it is in the registry. Routing broadcasts an order to every eligible LP,
-- and an LP who cannot possibly serve a corridor should never see it, let alone be able to lock it.
-- Cheap now, structural later.
--
-- NO CHECK CONSTRAINT ON country, deliberately. packages/shared/src/rails.ts is the only country
-- list in this system (project-model invariant 1, docs/21 product law). A CHECK here would be a
-- second one, and the two would drift the first time a rail is added. The route validates against
-- RAILS; this column just stores the answer.
alter table merchants add column if not exists country text;

-- Backfill from the rail, which IS the authority today (rails.ts: upi→IN, qris→ID, pix→BR).
-- 'bank' is an LP settlement method inside the India corridor (lib/corridors.ts), so it backfills
-- to IN along with UPI.
update merchants set country = case payout_rail
  when 'QRIS' then 'ID'
  when 'Pix'  then 'BR'
  else 'IN'
end where country is null;

alter table merchants alter column country set not null;

-- Performance tier, computed from signals that already exist (success_rate, avg_completion_secs,
-- dispute_rate, positive_rate, settled volume) in the merchantStats recompute pass. Never written
-- by hand, never by an admin — it is a view of behaviour, not a grant. Everything it buys an LP
-- (leverage, head start) is derived from it in code, so there are no reward columns to keep in sync.
alter table merchants add column if not exists tier smallint not null default 1;

-- Liveness. Touched by any authenticated merchant request; "warm" is a window over this. Nothing
-- else in the schema knows whether an LP is at their desk right now, which is the single strongest
-- predictor of whether they will actually pay an order in the next thirty seconds.
alter table merchants add column if not exists last_seen_at timestamptz;

-- WHO suspended this LP. Needed the moment auto-suspend gains an auto-reinstate, because three
-- different things write status='suspended' through the same setter:
--   merchantStats  — bond fell under the floor (machine, reversible by topping up)
--   /admin/merchants/:id/status  — a human moderating (routes/admin.ts:224)
--   the user-suspend cascade     — a blocked account must stop earning (routes/admin.ts:425),
--                                  documented one-way on purpose
-- Reinstating on bond alone would silently undo both human decisions. 'bond' means the machine did
-- it and the machine may undo it; NULL means a person did, and only a person reverses it.
--
-- Existing suspended rows backfill to NULL deliberately: we don't know why they were suspended, and
-- the safe default is to never auto-resurrect something we can't prove we suspended ourselves.
alter table merchants add column if not exists suspend_reason text;

-- listMerchantOrders, committedFloatByMerchant, and all four merchantStats aggregates key on
-- merchant_id with no index on it — and the stats four run every 10th confirmer tick, forever.
create index if not exists idx_orders_merchant on orders (merchant_id, created_at desc);

-- THE WAY OUT. Until now bond_usdc could only go up (creditStakeOnConfirm) or be fined down
-- (drawDownBond) — there was no offboarding at all, which makes staking a one-way door nobody
-- sane walks through.
--
-- Why a request table and not a transfer: envConfig.ts documents that STAKE_TREASURY_ADDRESS is a
-- PUBLIC KEY with no signer, deliberately — "add a secret key here only when merchants can offboard
-- and withdraw". Automating the release means a second hot key in env, which is a security decision
-- of its own and not one to make as a side effect of this. So the request is recorded, the bond is
-- debited immediately (money you are withdrawing must not still be backing orders), a cooldown runs,
-- and a human releases it from the admin console.
--
-- Debiting at REQUEST time, not at release, is the load-bearing choice: it means an LP cannot route
-- against a bond they have already asked for back, and if the debit drops them under MIN_BOND the
-- existing auto-suspend takes them out of routing, which is exactly right for someone leaving.
-- Cancelling restores it.
create table if not exists merchant_stake_withdrawals (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(id) on delete cascade,
  amount_usdc  numeric(20,6) not null check (amount_usdc > 0),
  status       text not null default 'requested' check (status in ('requested', 'released', 'cancelled')),
  requested_at timestamptz not null default now(),
  settled_at   timestamptz,
  -- The release tx signature once a human sends it, or the cancellation reason. Free text on
  -- purpose: this is a record of an out-of-band human action, not a machine-readable state.
  note         text
);

-- One open request at a time. Two concurrent requests could each pass the "bond covers it" check
-- and together debit more than the LP has (the balances CHECK would reject the second, but only
-- after the first had already committed — this makes it unrepresentable instead).
create unique index if not exists uq_stake_withdrawal_open
  on merchant_stake_withdrawals (merchant_id) where status = 'requested';
