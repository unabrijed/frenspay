-- 0025_email_canonical
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- WHY. users.email is identity: /auth/sync adopts a returning person by it, findUserByEmail decides
-- whether the invite gate applies, uq_users_email (0010) makes it one-account-per-mailbox. All of
-- them are EXACT matches, and 0010 chose case-sensitive on purpose, betting that Privy would always
-- hand back one spelling per mailbox — a bet Privy's docs never underwrite. One mailbox spelled two
-- ways would be two accounts, and the second sign-in would be asked to "finish setting up" an
-- account it already has. So the column has one canonical form: lowercase, trimmed. The backend
-- writes it that way at the only entrance (services/privy.ts getLinkedEmail); this makes the rule
-- the column's own.
--
-- Guard first, like 0010: the update cannot collapse two rows into one value the unique index
-- already forbids, and the bare error names a row nobody can act on. Fail with a count instead.
do $$
declare
  dupes int;
begin
  select count(*) into dupes from (
    select lower(btrim(email)) from users where email is not null
     group by lower(btrim(email)) having count(*) > 1
  ) d;
  if dupes > 0 then
    raise exception 'users.email has % mailbox(es) spelled more than one way — resolve manually before this migration can apply', dupes;
  end if;
end $$;

update users set email = lower(btrim(email)) where email <> lower(btrim(email));

-- A CHECK rather than a unique index on lower(email): every reader is `where email = $1`, which the
-- plain uq_users_email serves and an expression index would not; and a CHECK refuses any future raw
-- writer (a seed, a script, a second sync caller) loudly instead of letting it create a silent twin.
-- NULL passes, so deleteUser (which NULLs the address) is untouched.
-- ponytail: no matching CHECK on handle — every runtime writer canonicalizes and the seed is already
-- canonical; add one the day a raw writer appears.
alter table users add constraint users_email_canonical_chk check (email = lower(btrim(email)));
