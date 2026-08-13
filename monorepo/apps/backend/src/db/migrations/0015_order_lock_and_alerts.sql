-- 0015_order_lock_and_alerts — let an LP RESERVE an order before paying it, hide the payee until
-- they have, and give them a way to find out an order exists at all.
--
-- THE PROBLEM. Routing picks one LP at quote time and that LP is never told. They discover the
-- order only by having /merchant open on an 8s poll, and they have ten minutes to notice before the
-- escalation ladder starts. Meanwhile the payee's real UPI ID is handed to them the moment funding
-- confirms, whether or not they ever intended to pay it.
--
-- THE SHAPE. `merchant_id` stays the provisional holder — invariant 14 (never NULL) holds, and
-- committedFloatByMerchant, claimOrderPayout, the routing attempts trail and the worker all keep
-- working unchanged. The lock is a CAS that TRANSFERS it:
--
--   t+0             only merchant_id (routing's pick) may lock          payee hidden
--   offer_widens_at any eligible LP may take it                         payee hidden
--   locked          payee revealed to the lock holder, and only them
--   lock expires    cleared, re-opened, the abandonment is recorded
--
-- So the head start IS the reward for ranking first, and there is no offers table: the eligible
-- pool is the same query routing already runs, evaluated fresh, so it can never go stale.

alter table orders add column if not exists locked_at       timestamptz;
alter table orders add column if not exists lock_expires_at timestamptz;

-- When the exclusive window on the routed LP ends. NULL means "never widens", which is exactly
-- right for the orders that are not offered to anyone: a provider-settled or simulated order is
-- born locked, because its merchant row IS the settler and no pool was ever consulted.
alter table orders add column if not exists offer_widens_at timestamptz;

-- The open pool query: unlocked orders past their head start. Partial on locked_at because a locked
-- order is precisely what it must never return, and that is most of the table over time.
create index if not exists idx_orders_open_offers
  on orders (state, offer_widens_at) where locked_at is null;

-- BACKFILL FOR ORDERS ALREADY IN FLIGHT. claimOrderPayout now requires locked_at, so anything
-- sitting in payment_detected when this runs would otherwise never be claimable again:
--   * a provider- or sim-settled order would strand outright — its worker would keep reporting the
--     fiat leg paid and the claim would keep failing, silently, until the SLA refunded a payee who
--     had already been paid;
--   * a human-LP order would be un-claimable by the LP who is looking at it right now.
-- Same split the code applies from here on: rows with a human LP (sim_behavior null) become open
-- offers immediately, everything else is marked locked because its merchant row IS the settler.
update orders o
   set locked_at = now()
  from merchants m
 where m.id = o.merchant_id
   and o.state = 'payment_detected'
   and o.locked_at is null
   and m.sim_behavior is not null;

update orders o
   set offer_widens_at = now()
  from merchants m
 where m.id = o.merchant_id
   and o.state = 'payment_detected'
   and o.locked_at is null
   and m.sim_behavior is null;

-- WHY THE QUOTED SPREAD HAS TO BE STORED. The rate the payer sees is derived from ONE LP's
-- spread_bps (quoteEngine.ts). Offering that order to a pool is only safe if every LP who could
-- take it is content at that price, so the offer is filtered to spread_bps <= the quoted spread —
-- anyone who locks earns at least their own ask, and a cheaper LP who is faster keeps the
-- difference. That makes speed pay without inventing a bonus. It needs the number the quote was
-- actually struck at, and nothing recorded it: `rate` is display-only and post-fee, so the spread
-- cannot be recovered from it without the mid rate at that instant, which is gone.
--
-- Backfill 0: existing quotes are historical and are never re-offered (an order past
-- payment_detected is not in the pool), and 0 is the conservative direction — it would offer to
-- nobody rather than to an LP who would be underpaid.
alter table quotes add column if not exists spread_bps integer not null default 0;

-- How to reach this LP when an order lands. `alert_channel` names the adapter (services/alert),
-- `alert_address` is whatever that adapter addresses by — a Telegram chat id today, a device token
-- when the mobile app comes back. Two loose columns rather than a table per channel: an LP has one
-- way they want to be reached, and a channels table would be a join to answer that.
alter table merchants add column if not exists alert_channel text;
alter table merchants add column if not exists alert_address text;

-- Locking is a promise, and hiding the payee behind it creates a way to take orders hostage: lock
-- everything, pay nothing, and the pool is starved while every order waits out its TTL. Repeated
-- abandonment buys a timeout from locking (not from routing — an LP who forgets is not an LP who
-- defaults, and their bond has not been touched).
alter table merchants add column if not exists lock_bans_until timestamptz;
