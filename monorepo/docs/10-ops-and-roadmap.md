# 10 · Ops, infra & roadmap

## Deploy model

- **Backend — Railway**, one service, two environments driven by `NODE_ENV`: branch `stage` →
  stage env (`stage.api.frenspay.xyz`), branch `sacred` → prod (`api.frenspay.xyz`). **Both
  deployed envs run Solana MAINNET**; devnet exists only in local dev (the web app fails closed to
  mainnet when no RPC var is set).
- **Frontends — Vercel** (web, admin `admin.frenspay.xyz`, landing). The web app ships as a **Next
  server**, not a static export — the access-key gate (`src/middleware.ts` + `/gate`) is
  server-side.
- **Path-scoped deploys (HARD RULE):** a push deploys only the app whose files changed; a
  docs-only push deploys **nothing**. When a deploy misfires, debug the path filters — never
  remove them. There is exactly **one** implementation, `monorepo/scripts/vercel-ignore.mjs`, with
  a scope per target and a `--check` self-test (`yarn check:deploy`); Vercel calls it via
  `ignoreCommand`, the backend workflow calls it as `... backend`. Add a scope there when you add
  a deploy target — do not start a second filter somewhere else.
- **Railway builds nothing.** The backend service pulls a prebuilt image that GitHub Actions pushes
  to GHCR on a `stage` push. That keeps a multi-minute install off the critical path, so the API
  lands inside Vercel's build window rather than minutes from it — the frontend/backend version
  skew is a correctness problem, not just a slow one. The backend lands **first**, which is the
  safe order, so keep API changes backward-compatible for one deploy cycle.
- **Runbooks live at the repo root**, next to what they deploy: `DEPLOY.stage.md` (stage
  mainnet-lite: ON/OFF table, fee-payer funding, Helius webhook chores, smoke test) and
  `DEPLOY.md` (prod). Deployment is deliberately not a numbered doc.

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
| `sim` | local default (and currently forced on stage) | instant tier-2 promote, no documents |
| `didit` | stage/prod default | hosted document+liveness; tier raised later by the 15s reconciler poller (webhook = fast-path ping only) |

- **Sim:** onboard → Settings → *Verify identity* → instant tier 2. Re-test via dev-only
  *Reset for testing* (`POST /sim/kyc/1`) — the backend tier persists across logins otherwise.
- **Didit:** set `STAGE_DIDIT_API_KEY` + `STAGE_DIDIT_WORKFLOW_ID` (missing values with `didit`
  selected → the server **refuses to boot**, `assertKycConfig` — placeholder-looking values are
  rejected too). Complete the hosted flow; the poller fetches the authoritative decision
  (`approved` → tier 2 · `declined` → terminal · `expired`/`abandoned` → cleared so the user can
  restart). `STAGE_DIDIT_WEBHOOK_SECRET` + a reachable `/webhooks/kyc` make it feel instant;
  correctness never depends on it.
- Key files: `services/kyc/{index,didit,sim,poller}.ts`, `routes/kyc.ts`, `routes/webhooks.ts`,
  web `store/usePayStore.ts` (`verifyDone`, `pollKyc`, `resetForTesting`).

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
- **Phone-OTP channel** — parked decision (Privy SMS = US/CA-only; WhatsApp = all regions; the
  dashboard choice is irreversible). Nothing gets enabled without an explicit call.
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
