-- 0003_money_checks — sign constraints on every money column.
--
-- Numbered 0003, not 0002: stage has `0002_waitlist_first_name` applied (2026-08-06) whose .sql was
-- never committed — `waitlist.first_name` exists there and in no migration on disk. Reusing 0002
-- would have been silently skipped as already-applied. See the note at the bottom of this file.
--
-- The last guard that survives a NEW route forgetting to call normalizeAmount(). The app layer is
-- the real validator (it rejects excess precision, exponent notation, and NaN, none of which a
-- CHECK can see — `numeric(20,6)` silently rounds a 10-dp value *before* the constraint runs).
-- This catches the one class the cast can't: a negative or zero amount reaching the ledger.
--
-- `>= 0` where zero is legitimate (a waived fee, a drained float, an unbonded merchant);
-- `> 0` where a zero row is meaningless money movement. A CHECK passes on NULL, so the nullable
-- risk_events.amount_usdc needs no special case.

do $$ begin
  -- The ledger legs. A zero-amount transfer is a transaction that moves nothing but still costs
  -- a signature and a confirmer slot.
  if not exists (select 1 from pg_constraint where conname = 'transfers_amount_chk') then
    alter table transfers add constraint transfers_amount_chk check (amount_usdc > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_requests_amount_chk') then
    alter table payment_requests add constraint payment_requests_amount_chk check (amount_usdc > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_amount_chk') then
    alter table orders add constraint orders_amount_chk check (amount_usdc > 0);
  end if;

  -- Quotes: both legs and the rate must be positive — a zero rate would make `amount_inr / rate`
  -- a division by zero downstream, and a zero leg prices the order at nothing. Fees may be zero.
  if not exists (select 1 from pg_constraint where conname = 'quotes_amounts_chk') then
    alter table quotes add constraint quotes_amounts_chk
      check (amount_inr > 0 and amount_usdc > 0 and rate > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_fees_chk') then
    alter table quotes add constraint quotes_fees_chk
      check (fee_inr >= 0 and network_fee_inr >= 0);
  end if;

  -- Cross-chain (docs/19). fee_usdc/rail_fee_usdc default 0 on the Solana-local path.
  if not exists (select 1 from pg_constraint where conname = 'bridge_transfers_amount_chk') then
    alter table bridge_transfers add constraint bridge_transfers_amount_chk
      check (amount_usdc > 0 and fee_usdc >= 0 and rail_fee_usdc >= 0);
  end if;

  -- Merchant balances. bond_usdc is drawn down on dispute (`greatest(bond_usdc - $2, 0)` in
  -- queries.ts) and float_usdc is consumed by committed orders — both legitimately reach zero,
  -- neither may go below it.
  if not exists (select 1 from pg_constraint where conname = 'merchants_balances_chk') then
    alter table merchants add constraint merchants_balances_chk
      check (bond_usdc >= 0 and float_usdc >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Note for whoever hits this next: `schema_migrations` records `0002_waitlist_first_name` applied
-- 2026-08-06, but no such file was ever committed. Verified on stage: it added `waitlist.first_name
-- text`, which `0001_baseline.sql` does not create and no code currently reads. So a `db:reset` or a
-- fresh environment comes up WITHOUT that column while stage has it.
--
-- Nothing here depends on it, and it is not this migration's job to fix. To close it, add a new
-- forward migration using `add column if not exists` — a no-op on stage, correct everywhere else.
-- Do NOT recreate it as 0002: that version is already recorded and would be skipped.
