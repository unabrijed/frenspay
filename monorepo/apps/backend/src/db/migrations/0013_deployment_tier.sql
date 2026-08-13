-- 0013_deployment_tier — the database declares which tier owns it, so a cross-wired connection
-- string fails loudly instead of succeeding quietly.
--
-- The incident (2026-08-13): the stage Supabase database was set as the prod Railway environment's
-- DATABASE_URL. Prod served live traffic against another tier's data and nothing caught it —
-- envConfig prints the host at boot but warns only about the REVERSE case (a local run on the stage
-- DB), and the STAGE_/bare prefix convention is enforced by nobody. It surfaced only as "my account
-- has no rows", hours later.
--
-- Why a stamp and not a check on the env: a host allowlist needs maintaining, and "refuse if any
-- STAGE_* var is set" would not have caught this one — the stage URL was pasted into the BARE name.
-- The only thing that catches the whole class is the database itself knowing who it belongs to.
--
-- Two tiers, not four, on purpose: local and stage deliberately SHARE one database (there is no
-- LOCAL_DATABASE_URL — a local run writes straight to stage), so the only boundary worth defending
-- is production vs everything else. That maps exactly onto config.isProduction. Enforcement is
-- assertDatabaseTier() in db/tier.ts — verified at boot, claimed at db:deploy.
create table if not exists deployment_tier (
  -- Forced singleton: the primary key can only ever hold `true`, so a second row is impossible and
  -- `on conflict (singleton)` is a stable upsert target.
  singleton  boolean primary key default true check (singleton),
  tier       text not null check (tier in ('production', 'development')),
  claimed_at timestamptz not null default now()
);
