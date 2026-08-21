-- 0019_split_legs_and_payee_history
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- The PAIR RULE needs who-paid-whom-when (docs/06 § Routing). That history already exists:
-- claimOrderPayout is the only writer of payout_claimed_at and merchant_id can never change
-- afterwards, so orders ⋈ quotes IS the ledger. The view gives it a name; the indexes make the
-- rule's lookups (by payee → quotes → orders) index scans instead of sequential ones.

create index if not exists idx_orders_quote         on orders (quote_id);
create index if not exists idx_quotes_payee         on quotes (payout_destination) where payout_destination is not null;

-- Explicit pairing history. Read-only by construction: a claim IS the write.
create or replace view payee_payments as
  select o.id as order_id, o.merchant_id, o.user_id, q.payout_destination as payee,
         o.payout_claimed_at as paid_at, o.payout_utr as utr
    from orders o join quotes q on q.id = o.quote_id
   where o.payout_claimed_at is not null and q.payout_destination is not null;
