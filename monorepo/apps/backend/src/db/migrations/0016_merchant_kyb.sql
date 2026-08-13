-- 0016_merchant_kyb — turn KYB from a boolean an admin flips into something with evidence behind it
-- and a timeline in front of it.
--
-- WHAT IT WAS. `kyb_status` had three values and that enum was the ENTIRE record. Nothing was
-- collected, nothing was recorded about who decided or why, and the merchant saw one word with no
-- date and no reason. An LP rejected at 2am learned only that they had been rejected. That is not a
-- business check; it is a switch with a business-sounding name.
--
-- WHAT IT IS NOW. The personal side is already covered — /merchants/apply requires the same tier-2
-- Didit identity check that gates cash-out, so a human is verified before any of this. What was
-- missing is the BUSINESS: who they trade as, and which account the rupees will actually leave from.
--
-- NO DOCUMENT UPLOAD, deliberately. There is no file-storage path anywhere in this repo, and Didit
-- already holds the identity documents. Typed fields plus a human reading them is the honest first
-- rung; Supabase Storage (already in the stack) is the upgrade the first LP who needs to attach a
-- registration certificate will force, and not before.

-- The lifecycle gains the states a review actually passes through. 'pending' keeps its meaning
-- (applied, nothing submitted yet) so no existing row changes meaning under it.
--   pending     applied, no submission
--   submitted   the merchant sent their details
--   under_review a human picked it up
--   more_info   we asked for something; the merchant can resubmit (this is the one that makes the
--               flow a conversation instead of a coin flip)
--   approved / rejected  terminal
alter table merchants drop constraint if exists merchants_kyb_chk;
alter table merchants add constraint merchants_kyb_chk
  check (kyb_status in ('pending', 'submitted', 'under_review', 'more_info', 'approved', 'rejected'));

-- The submission itself. jsonb rather than a column per field because the required set is
-- per-country (packages/shared/src/kyb.ts) and India's PAN/GSTIN mean nothing in Indonesia — a
-- column each would be a migration every time a corridor opens, most of them null for most rows.
alter table merchants add column if not exists kyb_fields jsonb;
alter table merchants add column if not exists kyb_submitted_at timestamptz;

-- MERCHANT-VISIBLE. The reason for a rejection or a more-info request, written by the reviewer and
-- shown to the LP. The whole point: "rejected" alone is not a decision anyone can act on.
alter table merchants add column if not exists kyb_note text;

-- Append-only timeline, same shape as order_events (0001:138) and for the same reason: the status
-- column answers "where is it now", and the only way to answer "what happened, and when" without
-- reconstructing it from admin_actions is to write it down as it happens.
create table if not exists merchant_kyb_events (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  from_status text,
  to_status   text not null,
  event       text not null,
  -- Reviewer note, actor, which country's field spec was applied. NOT the submitted fields
  -- themselves: those live in merchants.kyb_fields, and copying business identifiers into an
  -- append-only log means they cannot be corrected or erased later.
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_kyb_events_merchant on merchant_kyb_events (merchant_id, created_at desc);
