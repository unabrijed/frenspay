-- 0022_telegram_and_contact_phone
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- Telegram identity + the one-time link token live on the users row (the 0020 phoneOtp shape:
-- one in-flight link per user, replaced on every mint, cleared on every terminal outcome — no
-- table, no sweeper). The one difference from phoneOtp: redemption arrives BY TOKEN (the bot
-- doesn't know the user yet), so lookup is by hash through a partial unique index and the redeem
-- is a single guarded UPDATE. sha256 stored, never the token — a DB read can't mint a link.
alter table users
  add column if not exists telegram_chat_id         text,
  add column if not exists telegram_username        text,
  add column if not exists telegram_linked_at       timestamptz,
  add column if not exists telegram_link_token_hash text,
  add column if not exists telegram_link_expires_at timestamptz;

-- One chat = one account. The 23505 here IS the 409 telegram_taken. Partial, like uq_users_phone:
-- NULL is genuinely absent, and deleteUser clears the column so a deleted account releases it.
create unique index if not exists uq_users_telegram_chat
  on users (telegram_chat_id) where telegram_chat_id is not null;
create unique index if not exists uq_users_telegram_link_token
  on users (telegram_link_token_hash) where telegram_link_token_hash is not null;

-- The LP's contact phone — NOT users.phone, which is the pay-by-phone directory opt-in; storing
-- an LP there would make them findable by every payer. verified_at stays null until a real
-- verification layer lands; 'telegram' is the only verified_via today (request_contact share).
alter table merchants
  add column if not exists contact_phone              text,
  add column if not exists contact_phone_verified_at  timestamptz,
  add column if not exists contact_phone_verified_via text;
alter table merchants drop constraint if exists merchants_contact_phone_via_chk;
alter table merchants add constraint merchants_contact_phone_via_chk
  check (contact_phone_verified_via is null or contact_phone_verified_via in ('telegram'));

-- Which Telegram messages mention an order, so the bot can edit them later: 'offer' (the alert
-- with Take/Pass — redrawn on taken/expired), 'reveal' (the payee message — redacted on give-back
-- and lock expiry; kept as the LP's record once paid, same policy as the console), 'prompt' (the
-- reply-with-the-UTR ask — edited on expiry so a stale prompt can't invite a doomed payment).
-- A table rather than columns on orders because phase-2 pool broadcast makes it N offer messages
-- per order; rows are deleted on successful edit and cascade with the order.
create table if not exists telegram_order_messages (
  order_id   uuid not null references orders(id) on delete cascade,
  chat_id    text not null,
  message_id bigint not null,
  kind       text not null check (kind in ('offer', 'reveal', 'prompt')),
  created_at timestamptz not null default now(),
  primary key (order_id, chat_id, kind)
);
