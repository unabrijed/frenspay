-- Existing Privy subjects and balances remain intact. Dynamic uses a distinct namespace.
alter table campaign_accounts rename column privy_did to auth_subject;
comment on column campaign_accounts.auth_subject is
  'Verified provider subject: original Privy DID or dynamic:environment:user. Never merge by email alone.';
