-- 0010_email_unique_index — enforce "one user = one email" at the DB level (docs/02). Until now
-- the rule was inherited from Privy's login model, not ours: /auth/sync copies the linked email
-- on every sync and nothing stopped two rows from holding the same address. routes/auth.ts maps
-- a violation of this index to 409 email_in_use.
--
-- Guard first: a unique index cannot be created over existing duplicates, and the bare Postgres
-- error names one arbitrary row nobody can act on. This fails loudly with a count instead, inside
-- the same transaction as the index, so it can never be skipped.
do $$
declare
  dupes int;
begin
  select count(*) into dupes from (
    select email from users where email is not null group by email having count(*) > 1
  ) d;
  if dupes > 0 then
    raise exception 'users.email has % duplicate value(s) — resolve manually before this migration can apply', dupes;
  end if;
end $$;

-- Partial: NULL (nothing synced yet) never collides with itself — same shape as the phone index.
-- Case-sensitive on purpose: Privy is the actual source of casing consistency for a mailbox.
-- ponytail: revisit with lower(email) if that assumption ever proves wrong.
create unique index if not exists uq_users_email on users (email) where email is not null;
