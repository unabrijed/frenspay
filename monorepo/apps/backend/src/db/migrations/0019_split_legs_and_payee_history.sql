-- 0019_split_legs_and_payee_history
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- Two things the LP marketplace could not say (docs/06):
--
-- 1. A payment may be settled in LEGS — N orders rows sharing one quote, each its own escrow PDA,
--    lock, claim, release and dispute, when no single LP's headroom covers it. A leg points at its
--    primary via group_id; the primary (and every ordinary single order) has group_id null, so
--    "the payment" is `id = X or group_id = X`. Each leg carries its own fiat amount; null means
--    the quote's (the single-order case, and every row that existed before this migration).
--    The quote keeps the plan it was priced against, because confirm happens up to 45 s later.
--
-- 2. The PAIR RULE needs who-paid-whom-when. That history already exists: claimOrderPayout is the
--    only writer of payout_claimed_at and merchant_id can never change afterwards, so
--    orders ⋈ quotes IS the ledger. The view gives it a name; the indexes make the rule's lookups
--    (by payee → quotes → orders, and by order → legs) index scans instead of sequential ones.

alter table orders add column if not exists group_id    uuid references orders(id);
alter table orders add column if not exists amount_fiat numeric(20,2);
alter table quotes add column if not exists legs        jsonb;

create index if not exists idx_orders_group         on orders (group_id) where group_id is not null;
create index if not exists idx_orders_fund_transfer on orders (escrow_fund_transfer_id);
create index if not exists idx_orders_quote         on orders (quote_id);
create index if not exists idx_quotes_payee         on quotes (payout_destination) where payout_destination is not null;

-- Explicit pairing history. Read-only by construction: a claim IS the write.
create or replace view payee_payments as
  select o.id as order_id, o.merchant_id, o.user_id, q.payout_destination as payee,
         o.payout_claimed_at as paid_at, o.payout_utr as utr
    from orders o join quotes q on q.id = o.quote_id
   where o.payout_claimed_at is not null and q.payout_destination is not null;
