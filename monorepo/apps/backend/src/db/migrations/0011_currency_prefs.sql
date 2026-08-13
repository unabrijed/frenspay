-- 0011_currency_prefs — server-stored currency choices (docs/05), so they follow the user across
-- devices instead of living only in the web store's persisted cache.
-- Both nullable, no backfill: null = "not chosen" — preferred falls back to the client's USD
-- default, local falls back to currencyForCountry(users.country), exactly as before this landed.
alter table users add column if not exists preferred_currency text;
alter table users add column if not exists local_currency text;
