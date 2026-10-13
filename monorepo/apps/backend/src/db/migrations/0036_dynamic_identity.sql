create table user_auth_subjects (
  subject text primary key,
  user_id uuid not null references users(id),
  created_at timestamptz not null default now()
);
create unique index user_auth_subjects_dynamic_user on user_auth_subjects(user_id)
  where subject like 'dynamic:%';
-- Durable signed receipt bytes are saved before broadcast, allowing identical retries.
alter table campaign_spends add column receipt_signed_tx text;
alter table prelaunch_spends add column receipt_signed_tx text;
