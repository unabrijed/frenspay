# 10 · Ops, infra & roadmap

## Deploy model

- **Backend — Railway**, one service per environment, driven by `NODE_ENV`: stage
  (`stage.api.frenspay.xyz`) and prod (`api.frenspay.xyz`). Only **stage** is wired — the CI
  workflow triggers on `stage` alone, so a `sacred` push currently deploys no backend at all; prod
  wiring is deliberately deferred to mainnet (`DEPLOY.md`). **Both deployed envs run Solana
  MAINNET**; devnet exists only in local dev (the web app fails closed to mainnet when no RPC var
  is set).
- **Frontends — Vercel** (web, admin `admin.frenspay.xyz`, landing). The web app ships as a **Next
  server**, not a static export — the access-key gate (`src/middleware.ts` + `/gate`) is
  server-side.
- **Path-scoped deploys (HARD RULE):** a push deploys only the app whose files changed; a
  docs-only push deploys **nothing**. When a deploy misfires, debug the path filters — never
  remove them. There is exactly **one** implementation, `monorepo/scripts/vercel-ignore.mjs`, with
  a scope per target and a `--check` self-test (`yarn check:deploy`); Vercel calls it via
  `ignoreCommand`, the backend workflow calls it as `... backend`. Add a scope there when you add
  a deploy target — do not start a second filter somewhere else.
- **Nothing is published to a registry.** CI uploads the checkout and Railway builds it. Pushing a
  prebuilt image would be faster, but it needs a **public** image (Railway gates private-registry
  pulls behind Pro) and the image is a readable codebase. The cost is skew: a Railway build is 3–5
  minutes against Vercel's 2–3, so the **frontend can land first** — the pairing that breaks. That
  makes backward-compatible API changes for one deploy cycle a rule, not a nicety.
- **Runbooks live at the repo root — exactly two, one per environment**, each complete for backend
  and frontends: `DEPLOY.stage.md` (stage mainnet-lite: how a deploy happens, service wiring, ON/OFF
  table, fee-payer funding, Helius chores, Vercel projects, rollback, troubleshooting) and
  `DEPLOY.md` (prod: the same shape with mainnet values, plus the mainnet checklist). No third file
  — a pipeline doc separate from the environment docs is how the two drift apart.

## Environment config convention

`NODE_ENV` picks the prefix — local/dev + stage read `STAGE_*` (local falls back through
`LOCAL_*` first), prod reads bare names. One `envConfig.ts` per app; config is **always-real** (no
mock toggles). Two operational facts worth their weight:

- **Local dev uses the shared stage DB** (Supabase) — there is no `LOCAL_DATABASE_URL`; the boot
  log names which DATABASE_URL source resolved and warns on the stage fallback.
- **Supabase: session pooler only.** The transaction pooler breaks Postgres advisory locks — which
  the money path depends on (below).

## Infra hardening (production-shaped, zero new infrastructure)

Built entirely on Postgres + in-process code — no Redis, no queue service:

- **In-app notifications** — `notifications` table + best-effort `notify()` (swallows its own
  errors: a notification must never fail a payment); web bell + unread badge + inbox sheet. Real
  push (FCM/APNs/web-push) is roadmap.
- **Per-user advisory lock** — `withUserLock(userId, fn)` (`pg_advisory_lock(hashtext(userId))`)
  wraps the daily-cap check→insert, closing the TOCTOU where two concurrent sends could both read
  "under cap". Dedicated lock pool, separate from the query pool. Verified by `check-infra.ts`.
- **Rate limiting** — in-house fixed-window limiter (~40 lines, per identity: bearer / dev header /
  IP) on money movement, auth, and the faucet. For the two **unauthenticated** waitlist routes the
  IP bucket is the *entire* defense — they are the only unauthed endpoints that write to the DB.
- **Observability** — in-memory counters at `GET /metrics` (Prometheus text) + pino latency logs.
- **Outbound email** — Resend REST over `fetch` (no SDK), best-effort like `notify()`; unset
  `RESEND_API_KEY` = clean no-op. The f-list confirmation is the only mail today.

🟡 All of it is **single-instance** by design (budget call): multi-instance needs Redis
locks/shared limiter/scrape target — see roadmap.

## KYC testing runbook

Two providers behind one API (`POST /kyc/verify` in `routes/kyc.ts`), selected by `KYC_PROVIDER`
(`STAGE_KYC_PROVIDER` on dev/stage):

| Provider | When | Behaviour |
|---|---|---|
| `sim` | local only — **never** on a deployed tier, both of which are mainnet | instant tier-2 promote, no documents |
| `persona` | stage **and** prod (also the default there, set or not) | hosted government-ID + selfie inquiry; tier raised by the 15s reconciler poller reading the inquiry back from Persona |

- **Sim:** onboard → Settings → *Verify identity* → instant tier 2. Re-test via dev-only
  *Reset for testing* (`POST /sim/kyc/1`) — the backend tier persists across logins otherwise.
- **Persona:** set `STAGE_PERSONA_API_KEY` + `STAGE_PERSONA_TEMPLATE_ID` (missing values with
  `persona` selected → the server **refuses to boot**, `assertKycConfig` — placeholder-looking values
  are rejected too). Complete the hosted flow; the poller fetches the authoritative inquiry
  (`approved`/`completed` → tier 2 · `declined`/`failed` → terminal · `expired` → cleared so the user
  can restart · `needs_review` → in review). No webhook is wired — the poller *is* the path; ≤15s.
- **Sandbox vs production keys.** A `persona_sandbox_…` key (what self-serve signup gives) runs the
  hosted flow with a force-pass/force-fail toggle and never sees a real document. It is the right key
  for **stage**; on **prod** `assertKycConfig` refuses it at boot. `persona_production_…` keys exist
  only after Persona's compliance review (or Startup Program approval) — until then prod has no
  working real-verification provider and must not be switched to `sim` (mainnet).
- **Allowed Domains** (Persona dashboard): if set, the web origin (`https://stage.frenspay.xyz`, …)
  must be listed or the user finishes at Persona and is never redirected home. Leave it empty, or
  list every origin that `safeReturnUrl` (`routes/kyc.ts`) already allows via `CORS_ORIGIN`.
- Key files: `services/kyc/{index,persona,sim,poller}.ts`, `routes/kyc.ts`, `routes/webhooks.ts`
  (401s everything for Persona — the seam stays, see the comment in `persona.ts`), web
  `store/usePayStore.ts` (`verifyDone`, `pollKyc`, `resetForTesting`), `app/(tabs)/home/page.tsx`
  (the `?inquiry-id=` return).

### Debugging a 503 `kyc_unavailable`

**Read the boot log first.** Every start with `persona` selected prints one `persona probe:` line
(`services/kyc/persona.ts probePersona`, non-fatal): `key OK (sandbox|production) [template=…
key=len…xxxx]` is healthy; `FAILED: … → 401` is the key as Railway holds it (diff `len`/last4
against a working local run). Templates aren't readable with a sandbox key, so a wrong template id
shows up on the first Verify instead — with the same fingerprint.

That code carries no diagnosis and is meant not to — it is emitted from one place (`routes/kyc.ts`)
and means only *"the call to Persona threw"*. The reason exists **solely** in the server log line
`kyc provider start failed`, which reads:

```
persona /api/v1/inquiries → <status> <body> [template=<itmpl_…> key=len<N>…<last4>]
```

Read it with `railway logs --service <service> --environment <env> | grep -i "kyc provider start failed" -A5`.
Trigger **one** verify before reading — the route is rate-limited to 5/min (`services/rateLimit.ts`),
and past that the error changes to `rate_limited`, which is noise rather than progress.

| Log shows | Cause | Fix |
|---|---|---|
| `→ 401 Must be authenticated` | key missing, mangled in the host's variable panel, or revoked | diff `len`/last4 against the dashboard; re-paste `PERSONA_API_KEY` |
| `→ 404`/`422` naming the template or `inquiry-template-id` | template id from another environment/organization, or a typo | copy `itmpl_…` from the dashboard's Inquiry Templates page |
| `→ 400` naming `redirect-uri` | the deployed `returnUrl` origin is rejected | check `safeReturnUrl` against `CORS_ORIGIN`, and Allowed Domains in Persona |
| `→ 429` | Persona rate limit | back off; the route itself is already capped at 5/min |
| no `→` at all | the 10s `FETCH_TIMEOUT_MS` aborted — Persona slow or unreachable | retry; raise the timeout only if it recurs |
| boot refuses with `sandbox key on a production tier` | a `persona_sandbox_…` key on prod | wait for the production key; do not switch prod to `sim` |

Two things that are **not** the cause, both ruled out before reading anything: an unset
`KYC_PROVIDER` (stage and prod default to `persona`), and missing credentials (`assertKycConfig` is
fatal at boot, so a service answering `/health` has them).

## Owed, and known

- **`apps/lp` needs its own path-scoped deploy filter** before it ships. The HARD RULE above is
  enforced by `scripts/vercel-ignore.mjs`, whose `--check` mode asserts per-app expectations by
  name — an app missing from `SCOPES` returns `true` and **deploys on every production push,
  docs-only included**. It fails open, so nothing warns you. `packages/ui` needs its own scope entry
  too: `SHARED` is only `packages/shared/`, so a design-system change would otherwise wake nobody.
- **Stake-withdrawal release has no admin surface** — manual SQL today; automating it means a second
  hot key in env, a security decision deliberately not taken as a side effect
  ([07](07-admin-and-moderation.md), [11](11-lp-console.md)).
- **Staked returns** are undecided and unbuilt. Stake is idle collateral.

## Roadmap

Replaces the old M0–M7 ladder: the shipped system is the baseline
([01](01-architecture.md)–[09](09-data-model.md)); what remains is grouped by what unlocks it.

### The Stage-B backlog — decided AND shipped 2026-08-13 (code side)

All seven landed the same day they were planned. What remains is operational, in this order:
**`yarn db:migrate`** (applies 0010 email-unique + 0011 currency-prefs + 0012 soft-delete on the
shared stage DB) → **`yarn workspace @fpay/backend tsx scripts/remint-invites.ts`** (the FREN
cutover) → the DB-backed checks (`check:admin`, `check-fees`). All Bridge-run.

| # | Work | Outcome |
|---|---|---|
| 1 | **FREN invite remint** | ✅ prefix + rerun-safe cutover script — [02](02-identity-and-onboarding.md) |
| 2 | **Migrations 0010/0011** | ✅ email unique index + 409 `email_in_use`; server currency prefs + `/me` plumbing (split into two files: different risk profiles) |
| 3 | **Soft-delete** | ✅ 0012 + `deleteUser` handle-release + console Delete + `account_deleted` screen — [07](07-admin-and-moderation.md) |
| 4 | **Flat-fee fold** | ✅ fee-first quoteEngine, `PLATFORM_FEE_BPS` deleted, check-fees rewritten — [05](05-fees-fx-and-display.md) |
| 5 | **USDC-only funding config** | ✅ nothing to build: Privy funding is never called; only the USDC ATA is credited; `asset:'USDC'` verified in the SDK as the one-liner if an on-ramp ever lands — [03](03-custody-money-in-and-confirmation.md) |
| 6 | **Balance UI** | ✅ flip + LocalCurrency pin + the eye (global + per-row reveal) + home → Add · Send |
| 7 | **Send-to-Contacts entry** | ✅ ContactsPrompt leads the Send sheet where the picker exists — [04](04-p2p-and-contacts.md) |

### Gated on ops or partners

- **Anchor mainnet deploy** (~1.5–3 SOL) → orders go live (remove the two 503 gates), real LP
  treasuries (seeded sim treasuries are derivable = drainable), fee sweep
  to a cold treasury.
- **UPI payout to non-users** (pay a phone number, lands in their UPI ID) — needs a licensed
  India payout partner; the settlement-model groundwork is [06](06-offramp-and-settlement.md).
- **Merchant QR pay** (scan-and-pay, EMVCo/QRIS parsing is built) — Phase 2, licensed partner per
  corridor; India `lp` legal question documented in [08](08-compliance-and-legalities.md).
- **QRIS/Indonesia activation** — Xendit production keys + settlement-float design (open) + the
  owed Indonesia compliance section.
- **Fiat receiving** (someone outside pays you) — collections via provider rails; after payouts.
- **CCTP cross-chain** (coded end-to-end, Sepolia-staged) — mainnet contracts + treasury funding +
  Privy smart-wallet/paymaster dashboard work.
- **Phone OTP at volume** — decided 2026-08-22: our own OTP, Message Central first (1,000 free
  credits, then ₹0.20/SMS). When volume arrives, swap the provider in `services/phoneOtp.ts` to
  Meta's WhatsApp Cloud API (₹0.115/OTP, needs Meta Business verification) or Telegram Gateway
  ($0.01). Stage needs `STAGE_MESSAGECENTRAL_*` set first.
- **External-deposit history ingestion** — on-chain deposits credit the balance but write no
  `transfers` row today ([03](03-custody-money-in-and-confirmation.md)); needs an inbound indexer.
- **Multi-instance infra** — Redis locks/shared rate-limit store, real push delivery, a metrics
  scrape target.
- **Mobile (Expo)** — parked out of the workspace; P2P-only parity when revived.

## Key files

`apps/backend/src/services/{notify,metrics,rateLimit,email}.ts` ·
`db/queries.ts` (`withUserLock`) · `routes/index.ts` (hooks + registrar) ·
`routes/{notifications,kyc,webhooks}.ts` · `apps/backend/scripts/{check-infra,check-waitlist}.ts` ·
`DEPLOY.stage.md` / `DEPLOY.md` (repo root) · web `components/sheets/notifications.tsx`
