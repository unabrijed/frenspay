-- 0021_push_tokens
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- Push notifications for the phone app. One row per device token; a token belongs to exactly one
-- user (re-registering after a different login moves it), and an uninstalled app's token is dropped
-- the first time Expo's push API answers DeviceNotRegistered for it (services/push.ts).
--
--   token         the Expo push token (ExponentPushToken[…]) — the primary key
--   platform      'android' | 'ios', informational
--   last_seen_at  bumped on every register, so a stale row can be swept by age one day

create table if not exists push_tokens (
  token        text primary key,
  user_id      uuid not null references users(id) on delete cascade,
  platform     text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists idx_push_tokens_user on push_tokens (user_id);
