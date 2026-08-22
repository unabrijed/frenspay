-- 0020_phone_otp
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- Pay-by-phone enrollment now runs on our own OTP (services/phoneOtp.ts) instead of Privy's phone
-- link, whose free plan only reaches US/Canada. The in-flight verification lives on the users row:
-- one per user, replaced by every new start, cleared on every terminal outcome — so there is no
-- table to sweep and no cleanup job.
--
--   phone_pending        the E.164 number a code was just sent to (null = nothing in flight)
--   phone_otp_ref        what the check compares against: the provider's verificationId when the
--                        provider mints the code (Message Central), sha256(code) when we do
--   phone_otp_expires_at 10 minutes after send
--   phone_otp_attempts   confirm calls so far; the sixth locks the verification out

alter table users
  add column if not exists phone_pending        text,
  add column if not exists phone_otp_ref        text,
  add column if not exists phone_otp_expires_at timestamptz,
  add column if not exists phone_otp_attempts   integer not null default 0;
