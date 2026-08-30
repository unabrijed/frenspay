-- 0023_payee_history_index
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- The pair rule (payeePaidSql, 0019) asks per candidate LP: "does an order of yours to this payee
-- exist with a claim in the cooldown window?" No index carries payout_claimed_at, so the EXISTS
-- walks that LP's whole order history on every quote, pool poll, and lock CAS — and the cooldown
-- just doubled to 180 days (routing.ts PAYEE_COOLDOWN_DAYS) while the baseline only grows.
-- Partial: rows that never claimed can't ever satisfy the predicate, so they don't belong in it.

create index if not exists idx_orders_merchant_claimed
  on orders (merchant_id, payout_claimed_at desc)
  where payout_claimed_at is not null;
