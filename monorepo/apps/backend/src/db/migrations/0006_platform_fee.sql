-- The platform's cut on an order, in USDC. Folded into the quoted rate (never a user-visible line
-- item): amountUsdc is priced at spread+platform bps, the LP is owed their spread-only amount, and
-- this column is the difference — collected at deposit into the fee-payer's ATA, returned on refund.
-- Old rows default 0: pre-migration orders release/refund exactly as before.
alter table quotes add column if not exists platform_fee_usdc numeric(20,6) not null default 0;
