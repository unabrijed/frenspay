-- Monad UPI simulation campaign. Never rewrites retired campaign or real-money tables.
create table campaign_accounts (
  id uuid primary key default gen_random_uuid(),
  privy_did text not null unique,
  email text not null unique,
  wallet_address text not null unique check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  campaign_id text not null default 'monad-upi-2026' check(campaign_id='monad-upi-2026'),
  is_test boolean not null default false,
  badges text[] not null default '{}',
  name text not null default '',
  country text not null default '',
  phone text unique,
  twitter_subject text unique,
  multiplier integer not null default 1 check (multiplier in (1,2,5,10)),
  peak_usdc numeric(20,6) not null default 0 check (peak_usdc >= 0),
  granted_credits numeric(24,6) not null default 0 check (granted_credits >= 0),
  reward_credits numeric(24,6) not null default 0 check (reward_credits >= 0),
  practice_credits numeric(24,6) not null default 0 check (practice_credits = 0),
  points numeric(24,6) not null default 0 check (points >= 0),
  balance_usdc numeric(20,6),
  balance_block numeric(24,0),
  balance_checked_at timestamptz,
  suspended boolean not null default false,
  pending_phone text,
  phone_otp_ref text,
  phone_otp_expires_at timestamptz,
  phone_otp_attempts integer not null default 0,
  phone_otp_sent_at timestamptz,
  phone_otp_day date,
  phone_otp_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table campaign_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references campaign_accounts(id),
  entitlement numeric(24,6) not null,
  amount numeric(24,6) not null check (amount > 0),
  peak_usdc numeric(20,6) not null,
  multiplier integer not null,
  created_at timestamptz not null default now(),
  unique(account_id, entitlement)
);

-- A previously rewarded verified connection cannot be rotated through multiple accounts.
create table campaign_identity_claims (
  kind text not null check (kind in ('phone','x')),
  identity_hash text not null,
  account_id uuid not null references campaign_accounts(id),
  primary key(kind, identity_hash)
);

create table campaign_quotes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references campaign_accounts(id),
  recipient_name text not null,
  payee_vpa text not null,
  payee_category text,
  payee_city text,
  qr_format text not null check(qr_format in ('uri','emv')),
  qr_hash text not null,
  amount_inr numeric(20,2) not null check (amount_inr > 0),
  credits numeric(24,6) not null check (credits > 0),
  inr_per_usd numeric(20,6) not null check (inr_per_usd > 0),
  fx_as_of timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table campaign_spends (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references campaign_accounts(id),
  quote_id uuid not null unique references campaign_quotes(id),
  idempotency_key uuid not null,
  reward_credits numeric(24,6) not null check (reward_credits >= 0),
  practice_credits numeric(24,6) not null check (practice_credits >= 0),
  points numeric(24,6) not null check (points >= 0),
  commitment text not null unique,
  receipt_payload text not null,
  receipt_status text not null default 'pending' check (receipt_status in ('pending','submitted','confirmed','review')),
  receipt_hash text unique,
  receipt_attempts integer not null default 0,
  receipt_started_at timestamptz,
  next_receipt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(account_id,idempotency_key),
  check (points = reward_credits)
);
create index campaign_spends_account_idx on campaign_spends(account_id,created_at desc);
create index campaign_receipts_pending_idx on campaign_spends(next_receipt_at) where receipt_status in ('pending','submitted');

create index campaign_quotes_payee_idx on campaign_quotes(payee_vpa);

create table campaign_withdrawals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references campaign_accounts(id),
  status text not null default 'prepared' check(status in ('prepared','submitted','confirmed','failed','cancelled')),
  recipient text not null,
  amount numeric(20,6) not null check(amount>0),
  tx_hash text unique,
  created_at timestamptz not null default now()
);

create unique index campaign_one_pending_withdrawal on campaign_withdrawals(account_id) where status in ('prepared','submitted');
