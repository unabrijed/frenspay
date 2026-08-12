-- 0008_flist_invite_gate — the f list becomes invite-only, and its members mint invites of their own.
--
-- Until now the landing page offered a code OR an email: a code sent you to the app, an email put
-- you on the queue, and the two never met. The f list was the consolation prize for people without
-- a code. It is now the opposite — a code AND an email are both required to join, and joining hands
-- you three codes of your own. Every member was vouched for by somebody, and can vouch for three.
--
-- Nothing here changes what a code IS. `redeemed_at` remains the single source of "spent", so a code
-- burned at the f-list door is equally dead at /auth/sync — `inviteCodeStatus` needed no edit at all.
-- What changes is that a code now has two doors, and only one of them ends in a user row.

-- An f-list member has no account, so `redeemed_by uuid references users(id)` has nowhere to put
-- them. Rather than loosen that column (its UNIQUE constraint is the "one account burns at most one
-- code" guarantee and is worth keeping exactly as strict as it is), record the other kind of
-- redeemer beside it. At most one of the two is ever set; both null with redeemed_at set is
-- impossible by construction.
alter table invite_codes add column if not exists redeemed_email text;

-- Whose invite this is, when the owner is an f-list member rather than an account. `owner_id` stays
-- NULL for these rows — and NULL in BOTH columns still means a house code minted from the console,
-- which is unchanged and still belongs to nobody.
alter table invite_codes add column if not exists owner_email text;
-- Mirrors idx_invite_codes_owner: the join reads back a member's own three by email the same way
-- the reveal screen reads a user's by id.
create index if not exists idx_invite_codes_owner_email on invite_codes (owner_email);

-- Which code let this person onto the list. Write-once (coalesce in queries.ts, same rule as
-- ref_code) — a re-submit carrying a different code must not rewrite who vouched for them, and does
-- not spend that second code either.
--
-- A real FK here, unlike waitlist.referred_by: that column is a polymorphic marketing string with no
-- table to point at, this one names a row in invite_codes that must exist. Lineage on the f list is
-- now as real as lineage on an account.
alter table waitlist add column if not exists invite_code text references invite_codes(code);
