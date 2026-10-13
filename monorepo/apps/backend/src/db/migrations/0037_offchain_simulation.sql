-- Flat 10x simulation allowance. Preserve credits already spent and grant only
-- the ungranted difference; profile edits and redeposits must not refill it.
insert into campaign_grants(account_id,entitlement,amount,peak_usdc,multiplier)
select id,peak_usdc*10,peak_usdc*10-granted_credits,peak_usdc,10
from campaign_accounts where peak_usdc*10>granted_credits;

update campaign_accounts
set reward_credits=reward_credits+greatest(0,peak_usdc*10-granted_credits),
    granted_credits=greatest(granted_credits,peak_usdc*10),multiplier=10;
alter table campaign_accounts alter column multiplier set default 10;

-- Keep historical broadcast records, but no longer queue new chain receipts.
alter table campaign_spends drop constraint campaign_spends_receipt_status_check;
alter table campaign_spends add constraint campaign_spends_receipt_status_check
  check(receipt_status in ('simulated','pending','submitted','confirmed','review'));
alter table campaign_spends alter column receipt_status set default 'simulated';
update campaign_spends set receipt_status='simulated'
where receipt_status='pending' and receipt_hash is null and receipt_started_at is null;
