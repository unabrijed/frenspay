-- 0026_stake_claims_and_payout_address
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- WHY. A partner could only stake USDC that was already in their fpay wallet, and the console has no
-- way to put it there — so nobody could reach the $100 floor and nobody could go online (docs/19).
-- Now a partner pays the stake treasury from wherever their USDC is and pastes the signature. This
-- table is that CLAIM: what the chain said the signature moved (read at submit — the amount is never
-- typed), who says it is theirs, and what a human decided. It never moves bond_usdc. Admin's credit
-- inserts a pending `transfers` row, the confirmer asks the chain before the flip (transferVerify),
-- and creditStakeOnConfirm credits bond + ledger in one statement (0024) — the same path the
-- in-wallet stake has always taken.
--
-- WHAT. Two unique indexes, deliberately:
--   · one claim per partner per signature, ever — bounds re-submission without a rate limiter, and
--     lets a reviewer flip ONE row (a mistaken reject is one click back);
--   · one LIVE claim (submitted / accepted) per signature — and a REJECTED claim releases it. The
--     treasury address is public, so anyone watching it can paste someone else's deposit first; the
--     impostor's refused claim must never lock the rightful owner out. The second submission is
--     stored as 'duplicate' pointing at the first, so the reviewer sees both and decides with the
--     sender address in front of them.
-- Also here, same subject: where a partner asked their stake to go BACK to. Null = their fpay wallet
-- at release time (listStakeWithdrawalsAdmin coalesces); the partner may name any wallet they hold.

create table if not exists merchant_stake_claims (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchants(id),
  signature     text not null,
  status        text not null default 'submitted'
                constraint merchant_stake_claims_status_chk
                check (status in ('submitted', 'accepted', 'rejected', 'duplicate')),
  -- { amountUsdc, sender, memo, blockTime, slot } as read off the chain at submit time.
  chain         jsonb not null,
  -- 'duplicate': the live claim that already held this signature (another partner's).
  duplicate_of  uuid references merchant_stake_claims(id),
  -- 'accepted': the transfers row admin's credit created; 'duplicate': the row that already held it.
  transfer_id   uuid references transfers(id),
  reviewed_by   uuid references users(id),
  reviewed_at   timestamptz,
  -- The reviewer's reason on a rejection — shown to the partner verbatim.
  note          text,
  created_at    timestamptz not null default now()
);

create unique index if not exists uq_stake_claim_partner_sig
  on merchant_stake_claims (merchant_id, signature);
create unique index if not exists uq_stake_claim_live_sig
  on merchant_stake_claims (signature) where status in ('submitted', 'accepted');
create index if not exists idx_stake_claims_merchant
  on merchant_stake_claims (merchant_id, created_at desc);

alter table merchant_stake_withdrawals add column if not exists payout_address text;
