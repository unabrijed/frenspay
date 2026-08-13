-- 0012_user_soft_delete — third lifecycle state (docs/07, decided 2026-08-13): delete is a
-- SOFT delete. Hard deletes are structurally impossible anyway (transfers/invite_codes/
-- admin_actions FK RESTRICT; orders/quotes/risk_events would CASCADE-wipe audit rows) and the
-- ledger must outlive the account. Enforcement is authPreHandler's existing status!='active'
-- gate; the handle is released by scrambling it at delete time (queries.ts deleteUser) — same
-- instant-release rule as admin renames, no tombstone (Bridge's accepted risk).
alter table users drop constraint users_status_chk;
alter table users add constraint users_status_chk check (status in ('active', 'suspended', 'deleted'));
