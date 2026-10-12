-- Provider attempts remain separate from LP escrow and from confirmed activity receipts.
create table merchant_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  payment_link text not null,
  provider_payment_id text not null,
  option_id text not null,
  policy_version text not null,
  chain text not null,
  mint text not null,
  wallet_address text not null,
  merchant text not null,
  amount_fiat numeric(24,8) not null check (amount_fiat > 0),
  currency text not null,
  amount_usdc numeric(20,6) not null check (amount_usdc > 0),
  expires_at timestamptz not null,
  collect_data_url text,
  status text not null default 'review' check (status in ('review','signing','processing','completed','failed','expired')),
  transactions jsonb,
  signed_transactions jsonb,
  result jsonb,
  transfer_id uuid unique references transfers(id),
  next_poll_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_payment_id)
);
create unique index merchant_payment_receipt_unique on merchant_payments(provider_payment_id) where status='completed';
create index merchant_payment_poll on merchant_payments(next_poll_at) where status='processing';
