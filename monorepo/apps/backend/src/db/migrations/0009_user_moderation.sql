-- 0009_user_moderation.sql — account lifecycle for users (admin suspend/unsuspend).
-- Text + check over boolean, mirroring merchants.status and the role rollout in 0001.
-- Default backfills every existing row to 'active'; enforcement lives in authPreHandler.
alter table users add column if not exists status text not null default 'active'
  constraint users_status_chk check (status in ('active', 'suspended'));
