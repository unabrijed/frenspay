-- 0005_payout_providers.sql — the payout-provider registry + per-order provider binding (docs/23).
--
-- One vendor is NOT one provider: each live country is its own vendor account with its own
-- credentials (xendit_id, xendit_th, ...), so "which provider serves this rail, in what order,
-- on or off" becomes operator-tunable data. Rows are ROUTING METADATA ONLY — adapters are code,
-- credentials are env (envConfig.payoutSecretKeys, resolved by provider id). A row is never
-- sufficient to move money: registry membership requires the credential to resolve AND
-- enabled = true, and enabled defaults false so a migrated row is inert until someone turns it on.
--
-- The three orders columns are the failover safety state (project-model invariants 12/13):
-- payout_provider_id is claimed BEFORE the first initiate (vendor idempotency does not span
-- accounts, so re-deriving selection per tick would double-disburse on any admin flip or restart);
-- payout_providers_tried is the exclusion set that makes "next by priority" total; and
-- payout_provider_ref keeps the vendor's own payout id — the only evidence that reconstructs a
-- post-mortem (payout_utr records the winner alone, and only on success).
create table if not exists payout_providers (
  id            text primary key
    constraint payout_providers_id_chk check (id ~ '^[a-z0-9_]{1,32}$'), -- env-key prefix + admin label
  adapter       text not null,               -- code module driving it ('xendit' | 'sim'); allowlist lives in code
  payout_method text not null
    constraint payout_providers_method_chk check (payout_method = '*' or payout_method in ('UPI','QRIS','Pix','bank')),
  priority      integer not null default 100, -- lower wins; ties broken by id
  enabled       boolean not null default false
);

alter table orders add column if not exists payout_provider_id text;
alter table orders add column if not exists payout_providers_tried text[] not null default '{}';
alter table orders add column if not exists payout_provider_ref text;
