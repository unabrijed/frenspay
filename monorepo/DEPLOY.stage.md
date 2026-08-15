# Stage deploy — backend → Railway, frontends → Vercel (Solana **mainnet-lite**)

Backend: Fastify (`apps/backend`) on Railway, stage environment, **real mainnet USDC** in
mainnet-lite mode. DB is Supabase Postgres. Frontends: per-environment Vercel projects (the OMS
model — see §Frontends). Prod is a separate doc: `DEPLOY.md`.

## Mainnet-lite: what's ON and OFF

Money-realness derives from the **mint**, not NODE_ENV: setting `STAGE_USDC_MINT` to Circle's
mainnet mint flips `config.isMainnet`, which hard-gates every dev money convenience regardless of
tier (envConfig.ts). Local dev keeps devnet — it reads the repo `.env`, not these dashboard vars.

| ON (real mainnet USDC)                             | OFF on stage                                   |
| -------------------------------------------------- | ---------------------------------------------- |
| Balance + on-chain deposit address (Solana)        | Faucet (403; UI hidden, onboarding skips fund) |
| P2P sends (@handle) + external sends               | Merchant-pay orders (503 `payments_unavailable` — escrow program not on mainnet yet) |
| Helius push confirmation (see §Helius)             | Cross-chain CCTP (routes unregistered — EVM side is Sepolia on dev tiers) |
|                                                    | `/sim/orders/*` (403), staking (leave stake treasury unset → 503) |

`/sim/kyc` stays live (tier gating only — acceptable behind the access gate). Money-in is
deposit-only: send USDC (Solana) to the address shown in Add money.

## How a deploy happens

One push to `stage` fans out to two independent systems. Nothing else triggers either — no manual
step, and **Railway has no GitHub connection**, so no push reaches it except through CI.

```
git push origin stage
├─ GitHub Actions  .github/workflows/backend-image.yml  ("backend deploy")   → the backend
└─ Vercel          one build per frontend project                            → web, admin, lp, landing
```

**One gate decides both.** `scripts/vercel-ignore.mjs` — Vercel calls it per project via
`ignoreCommand`, the workflow calls it as `... backend`. Exit 0 = skip, 1 = build. A docs-only push
deploys nothing, anywhere. Anything undecidable builds, because a wasted deploy costs money once
while a wrongly skipped one leaves a stale build on a live domain.

**How the backend image is built.** The workflow runs `railway up --ci` from the git root. That
uploads the checkout (`.gitignore` honoured — no `.env`, no `node_modules`) and Railway builds the
repo-root two-stage `Dockerfile` on its own builder:

- **builder** — `yarn install --frozen-lockfile` across every workspace, then
  `yarn workspace @fpay/backend build`: esbuild emits `dist/server.mjs` and `dist/migrate.mjs`,
  minified, no sourcemap.
- **runner** — those two bundles plus `node_modules`, the `.sql` migrations and `idl/escrow.json`.
  No `src/`, no frontends.

**How it deploys.** The container CMD runs `node dist/migrate.mjs deploy`, then
`node dist/server.mjs`. Migrations always precede the server, so it can never boot against a stale
schema. The `/health` healthcheck decides Active vs failed deploy.

**How the frontends deploy.** Vercel builds each project from its own `vercel.json`. The branch pin
is implicit: the gate skips unless `VERCEL_ENV=production`, which a project only sees on its own
Production Branch — `stage` here, `sacred` for the prod twins. Details in §Frontends.

> ### Nothing is published, anywhere
>
> No registry, no Docker Hub, no GHCR package, no public image. The built image exists only inside
> Railway. The repo stays private and so does the code.
>
> The faster design — build in Actions, push to a registry, let Railway pull — needs a **public**
> image, because Railway gates private-registry pulls behind the **Pro** plan and we are on
> **Hobby**. And a public image is a published codebase: `dist/server.mjs` is minified, not
> encrypted (route paths, fee math and the literal `frens@frenspay.xyz` all survive) and
> `dist/migrations/*.sql` is the schema in plain SQL. Renaming the registry repo does not help —
> anyone who pulls it identifies the project in seconds.
>
> Changing this is a deliberate decision, not a config tweak. The two-stage Dockerfile is already
> written for it if Railway ever goes Pro.

> **Deploy ordering is load-bearing, and it cuts against us.** A Railway build takes 3–5 minutes;
> Vercel finishes the frontends in 2–3, so the **frontend can go live first** — the pairing that
> breaks (old frontend + new backend is fine; the reverse is not). **Keep backend API changes
> backward-compatible for one deploy cycle**: add the new field/route first, switch the frontend to
> it on a later push, remove the old one after that.

## Service setup

1. **The Railway service.** Project `fpay`, environment **`stage`**, service **`frenspay-stage`** —
   it already exists and carries the `stage.api.frenspay.xyz` domain. If you are rebuilding this
   from scratch: New → **Empty Service**, never "Deploy from GitHub repo", because a repo connection
   deploys every push regardless of the gate.

   In its **Settings**, set healthcheck path **`/health`** and restart policy **ON_FAILURE, max 3**.
   The healthcheck is what turns a boot crash into a failed deploy instead of a live-but-broken API.
   (These used to live in a root `railway.json`; that file is gone, because Railway reads a repo
   config only when it builds from a connected repo, which this service never will.)

   Then give CI its credentials — GitHub → repo Settings → Secrets and variables → Actions:

   | kind | name | value |
   | --- | --- | --- |
   | **Secret** | `RAILWAY_STAGE_TOKEN` | a Railway **project** token scoped to the **stage** environment (Railway → project Settings → Tokens). Not an account token — those are read from `RAILWAY_API_TOKEN` and carry no project. |
   | **Variable** | `RAILWAY_STAGE_SERVICE` | the service name, **exactly** — `frenspay-stage` |

   **Do not type that name from memory — read it back.** `railway status` lists every service in the
   environment under `All resources`; the variable must match one of them character for character. A
   mismatch does not say "no such service", it fails as
   `Failed to upload code with status code 404 Not Found`, which reads like a broken token. That cost
   a full debugging round, and it is why the deploy step now runs `railway status` before uploading.

   The workflow hands that secret to the CLI as `RAILWAY_TOKEN`, which is the name the Railway CLI
   reads and the one thing here that cannot be renamed. The secret itself is environment-specific on
   purpose: a Railway project token *is* the environment selector, so one shared name would make the
   difference between stage and mainnet invisible at the call site.
2. Set `STAGE_DATABASE_URL` to the **Supabase session pooler** URL — same value as the working
   `apps/backend/.env` (`…pooler.supabase.com:5432`). Never the transaction pooler (port 6543): the
   backend and the migration runner take session-scoped `pg_advisory_lock`s, which transaction
   pooling silently breaks.
3. Set service **Variables** (in the stage environment, BEFORE the first deploy — secret values come
   from the working `apps/backend/.env`, which is the source of truth):
   ```
   NODE_ENV=stage
   STAGE_DATABASE_URL=<Supabase session pooler URL — step 2>
   STAGE_KYC_PROVIDER=sim                               # stage boot THROWS without KYC config (assertKycConfig); sim until Didit is live
   STAGE_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<KEY>   # mainnet RPC (Helius free tier)
   STAGE_HELIUS_API_KEY=<KEY>                            # push confirmation — see §Helius
   STAGE_HELIUS_WEBHOOK_SECRET=<openssl rand -hex 32>
   STAGE_FEE_PAYER_SECRET_KEY=[ ... ]                    # FRESH mainnet keypair — see below. JSON byte array ONLY (base58 is rejected)
   STAGE_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v   # Circle's MAINNET USDC — this is the real-money switch
   STAGE_PRIVY_APP_ID=<privy app id>
   STAGE_PRIVY_APP_SECRET=<privy app secret>            # backend-only, never in a web build
   PUBLIC_BASE_URL=https://<this-railway-service>.up.railway.app   # → https://stage.api.frenspay.xyz once the custom domain is attached (step 6)
   STAGE_CORS_ORIGIN=<see below>
   # leave STAGE_STAKE_TREASURY_ADDRESS and STAGE_ESCROW_PROGRAM_ID unset (staking 503s, orders are gated)
   # STAGE_PLATFORM_FEE_BPS optional (default 50) — dormant until merchant-pay ships on mainnet
   ```
   Do **NOT** set `PORT` — Railway injects it and the server binds `process.env.PORT` (host-level
   vars stay unprefixed by convention, like `PUBLIC_BASE_URL`).

   **The fee-payer is a fresh keypair, never the devnet one** (that key lives in plaintext local
   files): `solana-keygen new --no-bip39-passphrase -o stage-mainnet-feepayer.json`, paste the JSON
   byte array as the value, fund the address with **~0.1 real SOL** (it sponsors every tx fee +
   ATA rent), and keep the file offline. Its ATA also collects the platform fee, so monitor both
   balances. One-time flip chores: delete the old devnet-era Helius webhook in the Helius dashboard
   (registration is idempotent **by URL**, so the stale one blocks re-registration), and optionally
   mark any pending devnet-era bridge rows failed in SQL (the poller retries them harmlessly).
4. Deploy. Migrations auto-apply at boot — the image's `CMD` runs `db:deploy` before `start`, so the
   server can never come up against a stale schema. To apply by hand instead:
   ```
   yarn db:migrate   # applies pending apps/backend/src/db/migrations/*.sql
   ```
   (Run locally with `STAGE_DATABASE_URL` pointed at the Supabase session pooler, or via Railway's
   shell. `db:status` shows what's applied/pending.)
5. Verify: `curl https://<backend>/health` → `{"status":"ok","database":"configured"}`.
   A green build that still fails deploy = the `/health` healthcheck: the server crashed at boot —
   check the deploy logs (usually a missing variable from step 3).
6. **Custom domain (API)**: Settings → Networking → Custom Domain → `stage.api.frenspay.xyz`, then
   publish the CNAME Railway shows at the DNS provider. Once it resolves:
   - set `PUBLIC_BASE_URL=https://stage.api.frenspay.xyz` (a variable change redeploys; boot
     re-registers the Helius webhook against the new base), and
   - point web's `NEXT_PUBLIC_STAGE_API_URL` at it and redeploy web (`NEXT_PUBLIC_*` is inlined at
     build — a Vercel var change does nothing until the next deploy).
   Until the domain exists, the `*.up.railway.app` URL works everywhere the domain would. The API
   host is not a browser origin, so CORS needs no change for this step.

## CORS

`CORS_ORIGIN` empty = allow-all (dev convenience). The moment it's set, it must be the FULL
comma-separated list of EVERY browser origin that calls the API:

```
STAGE_CORS_ORIGIN=https://admin.frenspay.xyz,https://frenspay.xyz,https://www.frenspay.xyz,https://<web-domain>
```

A missing origin breaks that frontend in prod only, silently.

The admin origin appears in **both** environments' lists — stage's `STAGE_CORS_ORIGIN` above and
prod's bare `CORS_ORIGIN`. There is one admin console and it calls whichever backend the operator
selected, so each service has to allow that single origin independently.

## Helius — push confirmation

The confirmer poller already confirms transfers; Helius makes it push. The vars are in step 3. On
boot the backend auto-registers a webhook to `${PUBLIC_BASE_URL}/webhooks/helius` watching the
fee-payer (it signs every transfer). See `apps/backend/src/services/helius.ts`.

Note: registration always used the `enhanced` (mainnet) webhook type, so on devnet it was
effectively inert and the poller did the work — on mainnet it genuinely functions. If a stale
devnet-era webhook exists at the same URL, delete it in the Helius dashboard first (registration
is idempotent by URL and would report "already registered").

## Required before the console has its FIRST operator: root admins

```
STAGE_ADMIN_EMAILS=unabrijed@gmail.com
```

**Two steps, and the order is load-bearing.** Set this variable, wait for the redeploy, and only
then sign into **web** once with that address. The console never calls `/auth/sync` — only web does
— so that signin is the only thing that creates the operator's row and writes the Privy-verified
`users.email` this matches against. Backwards, the signup is treated as ordinary and refused with
`invite_required`, because the invite gate checks `ADMIN_EMAILS` *during* the sync in order to
exempt root admins. Skip both and the console answers 401 (no row at all) rather than 403.

Comma-separated Privy login addresses that are admin regardless of `users.role`, and that the
console refuses to demote. Everyone else is promoted from Admin → Users. This exists as the lockout
recovery path: the demote guards mean a bad click can't strip the last admin, and if one somehow
does, the env var still lets someone in without a psql session — which is also why a root admin
skips the invite gate. Codes are minted from the console, so needing one to reach the console you
are locked out of would be a circle.

## Optional: waitlist / referral emails (Resend)

All four vars, or nothing happens (unset is a deliberate, safe state — `/waitlist` keeps accepting
signups, no mail is sent, no share codes are minted):

```
STAGE_RESEND_API_KEY=re_...
STAGE_EMAIL_FROM=fpay <frens@frenspay.xyz>
STAGE_WAITLIST_SECRET=<openssl rand -hex 32>
STAGE_LANDING_URL=https://frenspay.xyz
```

`RESEND_API_KEY` without `WAITLIST_SECRET` logs a boot warning and stays disabled — a token minted
with an empty HMAC key could be forged. `WAITLIST_SECRET` is write-once in practice: rotating it
invalidates every outstanding confirm link and re-mints everyone's share code.

**Resend DNS** (resend.com → Domains → add `frenspay.xyz`) — publish the records it shows, then hit
Verify. Until the domain verifies, every send 403s and the failure is logged, not raised:

| Type  | Name                | Value                    |
| ----- | ------------------- | ------------------------ |
| TXT   | `send`              | `v=spf1 include:amazonses.com ~all` |
| CNAME | `resend._domainkey` | (the DKIM value Resend shows) |

Free tier is 3,000/month, 100/day.

## Frontends → Vercel (stage projects)

Model copied from OMS (it's the proven one): **one Vercel project per app per environment**. A
stage project's *Production Branch* is `stage`; the prod twin's is `sacred` (see `DEPLOY.md`).
Stage env vars live as that project's plain Production-env variables — no Preview-scoped juggling.
Ship to prod by merging `stage` → `sacred` (PR).

| project | Production Branch | Root Directory | config file |
| ------- | ----------------- | -------------- | ----------- |
| web (stage) | `stage` | **`monorepo`** | root `vercel.json` (builds `@fpay/web`, output `apps/web/.next`) |
| admin (**one project, both envs**) | `stage` | `monorepo/apps/admin` | `apps/admin/vercel.json` |
| lp (stage) | `stage` | `monorepo/apps/lp` | `apps/lp/vercel.json` |
| landing (stage, optional) | `stage` | `monorepo/apps/landing` | `apps/landing/vercel.json` |

### Project setup — every step, per project

1. **Create**: Add New… → Project → import `unabrijed/frenspay`. Framework preset resolves to
   Next.js from the app's `vercel.json`; install/build commands come from that file too — never
   override them in the dashboard.
2. **Settings → Build & Deployment**:
   - **Root Directory** per the table. Web only: also turn **OFF "Include source files outside of
     the Root Directory"** (same screen) — the crash note below is why.
   - **Node.js Version: 24** (`@solana-program/token` engine floor; `.yarnrc` ignore-engines masks
     it at install, set it anyway for runtime parity).
   - **Skip deployment for unaffected projects: Enabled**. Leave it on as a second net, but it is
     no longer what does the scoping — see the gate below. Its limit: it keys off the Root
     Directory and is extension-blind, so with admin's Root Directory set to the app dir, editing
     `apps/admin/README.md` deployed admin. Twice, before anyone noticed.
3. **Path gate — `ignoreCommand`, in the repo**. Each `vercel.json` runs
   `scripts/vercel-ignore.mjs <app>`, which decides from the commit diff: documentation
   (`*.md`, `.env.example`, `.gitignore`) never builds, each app wakes only for its own directory
   plus what it consumes (web/admin also on `packages/shared`; landing only its own dir), and the
   backend belongs to Railway so it wakes nothing here. Anything undecidable **builds** — a wasted
   deploy costs money once, a wrongly skipped one leaves a stale build on a live domain. Rules and
   their asserts are in one file; `yarn check:deploy` runs them.

   > This reverses an earlier decision that there would be no `ignoreCommand`s in the repo. That
   > reasoning was about the *branch* pin, which genuinely cannot live in a file both environment
   > projects share. A *path* gate is branch-independent, so it can.
4. **Branch pin.** The gate skips unless `VERCEL_ENV=production`, and a project only ever sees that
   on its **own** Production Branch — so one shared `vercel.json` pins the stage project to `stage`
   and the prod one to `sacred` without naming either. Nothing to set in the dashboard.

   If a project still has a hand-written **Ignored Build Step** from before this
   (`[ "$VERCEL_GIT_COMMIT_REF" = "stage" ] && exit 1 || exit 0`), **clear it** — `vercel.json`'s
   `ignoreCommand` overrides that field, so it is now dead config that reads as if it were live.
   Disabling **Preview Deployments** (Settings → Git) remains a fine belt-and-braces.
5. **Settings → Environment Variables** (plain Production env). Any change here is inert until the
   next deploy — `NEXT_PUBLIC_*` is inlined at build, and even runtime vars are baked into a
   deployment — so set variables, THEN deploy.

   web (stage):
   ```
   NEXT_PUBLIC_APP_ENV=stage
   NEXT_PUBLIC_STAGE_API_URL=https://stage.api.frenspay.xyz   # or the *.up.railway.app URL until the API domain exists
   NEXT_PUBLIC_STAGE_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com   # cluster switch: drives IS_MAINNET (hides faucet UI, Privy chain id)
   NEXT_PUBLIC_STAGE_PRIVY_APP_ID=<privy app id>
   NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID=<privy client id>
   NEXT_PUBLIC_STAGE_LANDING_URL=https://frenspay.xyz
   STAGE_ACCESS_KEY=<openssl rand -hex 32>                    # deploy access gate — see below
   ```
   admin (the only admin project — it serves both environments):
   ```
   NEXT_PUBLIC_APP_ENV=stage
   NEXT_PUBLIC_STAGE_API_URL=<same as web>                    # the "stage" target
   NEXT_PUBLIC_STAGE_PRIVY_APP_ID=<privy app id>
   NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID=<privy client id>
   # NEXT_PUBLIC_API_URL=https://api.frenspay.xyz             # the "prod" target — LEAVE UNSET
   ```
   Admin's two API hosts are **targets, not tiers**: both are inlined and the operator picks one in
   the sidebar, which is why there is no admin twin project. Leave the prod one unset until the prod
   backend exists — while it is unset the switch does not render and the console can only reach
   stage. Full reasoning and the safety model: `apps/admin/README.md` §Deploy.
   landing (stage):
   ```
   NEXT_PUBLIC_APP_ENV=stage
   NEXT_PUBLIC_STAGE_API_URL=<same as web>                    # POST /waitlist — code + email — posts here
   ```
   `NEXT_PUBLIC_STAGE_APP_URL` is no longer read and can be removed if it is already set. The landing
   page spends an invite code joining the f list rather than handing off to the app, so it links to
   the app in neither direction and needs no URL for it.
6. **Deploy**: push `stage` (or Deployments → Redeploy). Watch the log: install and build must run
   the `vercel.json` commands verbatim, and web must get past the post-build step (the historical
   crash below) to READY.
7. **Domain**: Settings → Domains → add the app's domain, publish the CNAME Vercel shows at the
   DNS provider. THEN add the new origin to the backend's `STAGE_CORS_ORIGIN` list (§CORS) — a
   missing origin breaks that frontend silently. If the landing domain ever changes, update
   `NEXT_PUBLIC_STAGE_LANDING_URL` (web) and `STAGE_LANDING_URL` (backend) to match.
8. **Test**, per app:
   - **web**: the domain serves the access-key form (HTTP 401) on every route; a wrong key shows
     the inline error; the right key lands in the app and a reload skips the form (device cookie).
     Then the real smoke test (real money, keep it small): Privy email login → onboarding skips
     the fund step straight to Home ($0) → Add money shows the Solana deposit address (no faucet,
     no EVM chips) → send it ~$2 real USDC from an exchange/wallet → balance appears (Helius push
     or poller) → `/sim/kyc` to tier 2 → a small P2P or external send, verified on Solscan. Network
     tab open throughout — every API call goes to the stage API origin, no CORS errors.
   - **admin**: loads (no gate configured), Privy login works, and a non-admin account is refused
     by the backend (`role='admin'` is checked server-side). With `NEXT_PUBLIC_API_URL` unset there
     must be **no stage/prod switch in the sidebar** — if one renders, a prod host got set early.
   - **landing**: static pages render; a waitlist signup round-trips (needs the Resend block
     above, otherwise it accepts silently without mail — that's the documented safe state).

### Deploy access gate (web only)

`apps/web/src/middleware.ts` + the `/gate` route. Until a device presents the key, every route
serves a key form; the right key sets a year-long `fpay_gate` cookie (the key's SHA-256, httpOnly)
and that device never sees the form again. Unset key = gate off — the local-dev default. Rotate
`STAGE_ACCESS_KEY` to evict every device on the environment. The middleware matcher deliberately
skips `_next/*`, `icon.svg`, `apple-icon.png`, `favicon*`, `manifest*`, so a gated tab still gets
its icon — that asymmetry is expected, not a leak. The prod twin sets bare `ACCESS_KEY` with a
**different** key (`DEPLOY.md`). Because of the gate, web ships middleware — it is a server app on
Vercel and can never become a static export like landing.

### Why web's include-outside-root toggle is OFF (the `noop.js` crash)

Root cause of `noop.js` → `Cannot find module …server.runtime.prod.js`: with the toggle ON,
`/vercel/path0` is the *git* root (`payments/`), but `next build` records the app dir relative
to `outputFileTracingRoot` (the monorepo — pinned in `apps/web/next.config.ts`), so
`@vercel/next` resolves Next from `/vercel/path0/apps/web`, which doesn't exist. OFF makes
`/vercel/path0` = the monorepo and the roots coincide. (`noop.js` is `resolve-from`'s synthetic
module name, not a real file — the crash is the same in any Root Directory pattern.)

Admin can't use that toggle (its Root Directory is the app dir; install/build need the workspace
root above it) and WILL hit the same crash on its first deploy. Fix then: set admin's
`outputFileTracingRoot` to the git root (`payments/`) so its recorded app dir becomes
`monorepo/apps/admin`.

## Pre-push build gate

`monorepo/.githooks/pre-push` builds EVERYTHING on every push — only successful builds leave the
machine: `yarn install --frozen-lockfile`, then the landing/web/admin builds (each app's Vercel
buildCommand verbatim), then `yarn workspace @fpay/backend tsc --noEmit` and
`yarn workspace @fpay/backend build` — the typecheck catches what would otherwise crash the server
at boot, and the bundle catches what only bundling can break (a *value* import of `@fpay/shared`,
which is external in the bundle and would fail to resolve inside the container).

Enable once per clone (git config, not a committed setting):

```
git config core.hooksPath monorepo/.githooks
```

Bypass deliberately with `git push --no-verify`.

## Test a deploy

Push a backend-scope change to `stage` — a comment in `apps/backend/src/server.ts` is enough — and
watch, in order:

1. **Actions → "backend deploy".** Open the **gate** step: silent means *build*; the
   `Nothing in the backend scope changed` notice means it decided to skip. Then Railway's build log
   streams into the deploy step (that's `--ci`). Expect 3–5 minutes.
2. **Railway → `frenspay-stage`.** A deployment appears and goes **Active** once `/health` answers.
3. **Its logs.** Migrations applied (or "no pending"), then the server listening on `0.0.0.0`.
4. **The API.**
   ```sh
   curl -s https://stage.api.frenspay.xyz/health
   # → {"status":"ok","database":"configured"}
   ```
   Use the `*.up.railway.app` URL Railway shows until the custom domain is attached (§Domains).

Then the negative test: push a change to a `.md` file alone. **Correct behaviour is no workflow run
and no Vercel deploy.** That is the gate working — a docs-only push deploying anything is the bug,
so debug the gate, never remove it. Locally: `node scripts/vercel-ignore.mjs backend; echo $?`
(0 = skip, 1 = build), and `yarn check:deploy` runs the rule asserts.

Frontend checks are per app in §Project setup step 7.

## Rollback

**Backend.** There are no image tags to re-pin — Railway's deployment history *is* the rollback:
**Railway → `frenspay-stage` → Deployments → the last good one → Redeploy.** It redeploys that
build's image, no rebuild. If the bad commit is already on `stage`, revert it in git too, or the
next backend-scope push ships the same breakage again.

Migrations do **not** roll back. A deploy that applied one and then failed leaves the schema
forward — which is why migrations must be written additively.

**Frontends.** Vercel → the project → Deployments → an older one → Promote to Production.

## When it goes wrong

| Symptom | Cause / fix |
| --- | --- |
| Railway deployed something CI didn't push | The service got connected to the GitHub repo (Settings → Source). Disconnect it — its only source should be the CI upload. |
| Workflow never ran | The change was outside the backend scope. Check with `node scripts/vercel-ignore.mjs backend; echo $?`. Ship it anyway with Actions → Run workflow, which skips the gate deliberately. |
| `Failed to upload code with status code 404 Not Found` | `RAILWAY_STAGE_SERVICE` names a service that doesn't exist in this environment. The `railway status` output printed just above it lists the real names under `All resources` — copy one exactly. This is the most likely cause by far; the 404 is Railway's answer for "no such target", not for a bad token. |
| `railway up` fails: unauthorized | `RAILWAY_STAGE_TOKEN` missing, expired, or scoped to the wrong environment. It must be a **project** token for **stage**. An account token (from Account Settings) is read from `RAILWAY_API_TOKEN`, carries no project, and makes `railway status` fail to resolve one. |
| Deploy stuck "waiting for healthcheck" | `PORT` was set by hand (never set it — Railway injects it), or the server crashed at boot. The deploy logs carry the real error. |
| Boot throws on KYC config | `assertKycConfig` — stage refuses to start without it. Set `STAGE_KYC_PROVIDER` (§Service setup step 3). |
| `prepared statement does not exist` / lock hangs | `STAGE_DATABASE_URL` points at the transaction pooler (`:6543`). It must be the **session** pooler (`:5432`). |
| Build fails on an unpublished `@fpay/*` package | A new workspace's `package.json` isn't COPY'd before the install layer in the root `Dockerfile`. Its header explains why; add the line. |
| `Cannot find package '@fpay/shared'` at runtime | A *value* import of `@fpay/shared` reached the bundle, where it is external. Make it `import type`. |
| CORS errors from the app | `STAGE_CORS_ORIGIN` doesn't list the origin — §CORS. |
