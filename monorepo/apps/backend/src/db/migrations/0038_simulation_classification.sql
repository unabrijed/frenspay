-- Permanent business classification, independent of receipt/chain status and
-- deployment mode. Defaults classify existing rows as well as future inserts.
-- Never merge either ledger into real transfers or expense totals at launch.
alter table campaign_spends
  add column transaction_kind text not null default 'simulation' check (transaction_kind = 'simulation'),
  add column counts_toward_expenses boolean not null default false check (counts_toward_expenses = false);

alter table prelaunch_spends
  add column transaction_kind text not null default 'simulation' check (transaction_kind = 'simulation'),
  add column counts_toward_expenses boolean not null default false check (counts_toward_expenses = false);

comment on column campaign_spends.transaction_kind is 'Simulation only, even if a historical receipt was confirmed onchain. Never a real payment.';
comment on column campaign_spends.counts_toward_expenses is 'Always false. Exclude from real spending, expense reports and real-money totals.';
comment on column prelaunch_spends.transaction_kind is 'Retired prelaunch simulation only. Never a real payment.';
comment on column prelaunch_spends.counts_toward_expenses is 'Always false. Exclude from real spending, expense reports and real-money totals.';
