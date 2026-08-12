-- Real invite codes. Until now the "invite code" was an existing user's @handle and the allowance
-- was a counter (users.referral_limit), which meant nobody — not even an admin — could generate an
-- invite: the only lever was `update users set referral_limit = ...` by hand. Codes are now real
-- rows, so they can be minted, listed, revoked and audited from the console.
--
-- The code is stored in PLAIN TEXT on purpose. The user sees their three exactly once, at signup,
-- and never again (users.invites_revealed_at below) — but an operator has to be able to read one
-- back to answer "who has what", so this is not a secret we hash.
create table if not exists invite_codes (
  -- 'FP-XXXX-XXXX', canonical uppercase. PK because redemption locks this row by code and the
  -- uniqueness IS the "one code, one use" rule.
  code        text primary key,
  -- Whose invite this is. NULL = a house code minted from the admin console: it belongs to nobody,
  -- so no user's allowance constrains it. That is the standing answer to "we're out of invites".
  owner_id    uuid references users(id),
  -- UNIQUE: an account burns at most one code, ever. Cheap structural guarantee that a replayed
  -- /auth/sync can't consume a second invite for the same person.
  redeemed_by uuid unique references users(id),
  redeemed_at timestamptz,
  -- Revoke sets this rather than deleting the row, so a revoked code can never be re-minted by
  -- chance and the audit trail keeps pointing at something real.
  revoked_at  timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);
-- The console lists by owner ("who has what") and the reveal screen reads a user's own three.
create index if not exists idx_invite_codes_owner on invite_codes (owner_id);

-- Status is DERIVED, never stored: unused = redeemed_at is null and revoked_at is null.
-- Storing it too would let the two disagree.

-- One look, then gone. While this is NULL /me returns the code strings; POST /me/invites/ack stamps
-- it and they stop being returned. Server-side, because a client-side "seen" flag is a suggestion.
alter table users add column if not exists invites_revealed_at timestamptz;

-- The count of invite_codes rows IS the allowance now, so the counter is redundant — and worse than
-- redundant, since the two could drift. "Give someone more invites" becomes "mint them more codes",
-- which is auditable and produces real objects. users.referred_by STAYS: it now points at the
-- redeemed code's owner_id, so invite lineage is unchanged and still write-once.
alter table users drop column if exists referral_limit;

-- admin_actions gains four action names — invite_mint, invite_revoke, role_grant, role_revoke —
-- and one target_kind, 'invite'. No DDL needed: both columns are free text with no CHECK, which is
-- exactly why they were built that way. The enumerating comment on the table in 0001 is stale and
-- stays stale: it was applied, so editing it now would trip the checksum drift warning. This is the
-- forward-only place to record them.
