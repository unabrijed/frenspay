-- 0029_quote_mid_rate
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- WHY. A quote stored its all-in rate (display-only, post-fee) and the LP spread, but never the
-- mid-market rate it was struck against: quoteEngine read it into a local and dropped it. The mid
-- is the one input that makes the fee and the spread VERIFIABLE rather than asserted, and it
-- cannot be recovered later. The FX source is a "latest" endpoint with no history, and inverting
-- rate + spread + fee is unique only while lpRate^2 / amountFiat < 100: fine for INR at normal
-- sizes, five candidate mids for a 500,000 IDR order. Evidence for a rate dispute, read by the
-- admin console only, never shown to the payer (docs/05, docs/22).
--
-- Nullable: rows struck before this migration have none. A null mid_rate_as_of on a set mid_rate
-- means the quote priced off the configured fallback rate (fxRate.getMidRateAsOf is null then).
alter table quotes add column if not exists mid_rate       numeric(20, 6);
alter table quotes add column if not exists mid_rate_as_of timestamptz;

-- The admin ledger joins transfers to orders on BOTH escrow pointers. The fund side has had
-- idx_orders_fund_transfer since 0019; the release side had nothing.
create index if not exists idx_orders_release_transfer on orders (escrow_release_transfer_id);
