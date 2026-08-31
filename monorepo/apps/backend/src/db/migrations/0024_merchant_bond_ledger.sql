-- 0024_merchant_bond_ledger
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- WHY. merchants.bond_usdc was a number with no history: deposits added to it (creditStakeOnConfirm),
-- withdrawal requests subtracted (requestStakeWithdrawal), upheld disputes drew it down
-- (drawDownBond) — and only the first two left any row behind, in two different tables. Nothing
-- could answer "what did this partner stake, when, and where did every dollar go", and the
-- treasury balance had no ledger to be reconciled against. Money held on trust with no ledger is
-- not segregated, whatever wallet it sits in (docs/15).
--
-- WHAT. One append-only ledger, written IN THE SAME STATEMENT as every bond_usdc mutation, with
-- signed amounts so that for every merchant  bond_usdc = Σ merchant_bond_events.amount_usdc
-- (scripts/check-bond.ts asserts it; drift is a bug, never something to repair). bond_usdc stays
-- the authoritative column every reader already uses; the ledger is how it is proven.
--
-- Also here, because they are the same subject:
--   · a typed release signature on stake withdrawals (it lived in free-text `note`), unique so a
--     release can only ever be recorded once, and who recorded it
--   · the exit flag: leaving is a withdrawal of the whole bond with `exit = true`, and a merchant
--     that has left is frozen by trigger — no writer, present or future, may move its status
--   · the two FKs that would have CASCADED this history away on a merchant delete become plain
--     references: a partner is never deleted, only marked (docs/15), and the schema now says so

create table if not exists merchant_bond_events (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchants(id),
  kind          text not null constraint merchant_bond_events_kind_chk
                check (kind in ('deposit', 'withdraw_request', 'withdraw_cancel', 'penalty', 'opening', 'adjust')),
  -- Signed: deposits and cancels positive, requests and penalties negative. Zero is not an event.
  amount_usdc   numeric(20, 6) not null constraint merchant_bond_events_amount_chk check (amount_usdc <> 0),
  transfer_id   uuid references transfers(id),
  withdrawal_id uuid references merchant_stake_withdrawals(id),
  dispute_id    uuid references disputes(id),
  actor_user_id uuid references users(id),
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_bond_events_merchant on merchant_bond_events (merchant_id, created_at desc);

-- Whatever a merchant holds today becomes its opening balance. Penalties before this migration
-- wrote nothing, so their history is unreconstructible — an honest 'opening', not a fake backfill.
insert into merchant_bond_events (merchant_id, kind, amount_usdc, note)
select m.id, 'opening', m.bond_usdc, '0024 backfill'
  from merchants m
 where m.bond_usdc <> 0
   and not exists (select 1 from merchant_bond_events e where e.merchant_id = m.id and e.kind = 'opening');

-- The release, typed. `note` stays as the human's free text.
alter table merchant_stake_withdrawals add column if not exists release_signature text;
alter table merchant_stake_withdrawals add column if not exists released_by uuid references users(id);
alter table merchant_stake_withdrawals add column if not exists exit boolean not null default false;
create unique index if not exists uq_stake_withdrawal_release_sig
  on merchant_stake_withdrawals (release_signature) where release_signature is not null;

alter table merchants add column if not exists exited_at timestamptz;

-- Never delete a partner: their stake ledger and their KYB record are what make "we held your
-- money" and "a human checked" reconstructible later. The cascades made one DELETE erase both.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'merchant_stake_withdrawals_merchant_id_fkey' and confdeltype = 'c') then
    alter table merchant_stake_withdrawals drop constraint merchant_stake_withdrawals_merchant_id_fkey;
    alter table merchant_stake_withdrawals
      add constraint merchant_stake_withdrawals_merchant_id_fkey foreign key (merchant_id) references merchants(id);
  end if;
  if exists (select 1 from pg_constraint where conname = 'merchant_kyb_events_merchant_id_fkey' and confdeltype = 'c') then
    alter table merchant_kyb_events drop constraint merchant_kyb_events_merchant_id_fkey;
    alter table merchant_kyb_events
      add constraint merchant_kyb_events_merchant_id_fkey foreign key (merchant_id) references merchants(id);
  end if;
end $$;

-- A merchant that has left is frozen. This is a trigger — the first in this schema — and
-- deliberately so: three different writers touch merchants.status today (setMerchantStatus, the
-- KYB decision's CASE, the sim writer), and a predicate on one of them leaves the class half-fixed.
-- The trigger is the one gate every present and future writer passes through. Routes map the
-- 'merchant_exited' message to a 409.
create or replace function merchants_exited_frozen() returns trigger language plpgsql as $$
begin
  if old.suspend_reason = 'exited'
     and (new.status is distinct from old.status or new.suspend_reason is distinct from old.suspend_reason) then
    raise exception 'merchant_exited';
  end if;
  return new;
end
$$;

drop trigger if exists merchants_exited_frozen on merchants;
create trigger merchants_exited_frozen
  before update of status, suspend_reason on merchants
  for each row execute function merchants_exited_frozen();
