-- 0004_corridor_currency.sql — the fiat leg gets an explicit currency (Indonesia corridor).
-- Every existing row is INR by construction (the app was UPI-only until now), so the backfill IS
-- the default. Column scale stays numeric(20,2) for every corridor — a 0dp IDR amount stores as
-- x.00; validation/display decimals live in code (fiatDecimals), not the schema.
alter table quotes add column currency text not null default 'INR';

-- QRIS joins the rail vocabulary (constraint names from 0001).
alter table merchants drop constraint merchants_rail_chk;
alter table merchants add constraint merchants_rail_chk check (payout_rail in ('UPI','QRIS','Pix','bank'));
alter table quotes drop constraint quotes_payout_chk;
alter table quotes add constraint quotes_payout_chk check (payout_method in ('UPI','QRIS','Pix','bank'));

-- 'psp' joins the LP discriminator: the payout provider (services/payout) executes the fiat leg
-- via API. (NULL stays "real human merchant" — see 0001's drop of NOT NULL/default.)
alter table merchants drop constraint merchants_sim_chk;
alter table merchants add constraint merchants_sim_chk check (sim_behavior in ('happy','slow','no_receipt','timeout','psp'));
