# Stage deploy — backend → Railway, frontends → Vercel (Solana **mainnet**)

Backend: Fastify (`apps/backend`) on Railway, stage environment, **real mainnet USDC**. DB is Supabase Postgres. Frontends: per-environment Vercel projects (the OMS
model — see §Frontends). Prod is a separate doc: `DEPLOY.md`.

## What's ON and OFF — capability-derived, never tier-derived

There is no testnet tier (2026-08-30): local, stage and prod are all Solana mainnet with real USDC,
and the faucet, the `/sim/orders/*` controls and the Sepolia contract table are gone rather than
gated. What remains switchable is a **capability** the backend derives from its own config at boot:

| Capability | Derived from | Off ⇒ |
| --- | --- | --- |
| Merchant-pay orders (`escrowLive`) | `STAGE_ESCROW_SECRET_KEY` + `STAGE_PLATFORM_FEE_DESTINATION` usable (§Keys, docs/16); `STAGE_FEE_PAYER_SECRET_KEY` optional — unset = Privy-sponsored gas | `503 payments_unavailable` on quote + order |
| Identity verification (`personaLive`) | `STAGE_PERSONA_API_KEY` + `STAGE_PERSONA_TEMPLATE_ID` real | `/kyc/verify` 503s, every tier gate lifts (docs/14) |
| LP staking | `STAGE_STAKE_TREASURY_ADDRESS` set (public key, no signer) | `503 staking_unavailable` |
| Cross-chain CCTP | `STAGE_EVM_MINTER_PRIVATE_KEY` + the three EVM RPC urls | `503 crosschain_unavailable` (routes always registered) |

`/sim/kyc` stays live (tier gating only — acceptable behind the access gates). Money-in is
deposit-only: send USDC (Solana) to the address shown in Add money.

## How a deploy happens

One push to `stage` fans out to two independent systems. Nothing else triggers either — no manual
step, and **Railway has no GitHub connection**, so no push reaches it except through CI.

```
git push origin stage
├─ GitHub Actions  .github/workflows/backend-image.yml  ("backend deploy")   → the backend
└─ Vercel          one project builds from `stage`: frenspay-stage             → web
                   (admin, lp, landing are on `sacred`: they build from the stage → sacred merge, §Frontends)
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
Production Branch. Only web has a stage project (`frenspay-stage`, Production Branch `stage`);
admin, lp and landing are one project each on `sacred`, so a stage push builds web alone and the
other three ship when `stage` is merged to `sacred`. Details in §Frontends.

**Deploying on demand.** Actions → **backend deploy** → **Run workflow** → branch `stage`. That is
`workflow_dispatch`, and it skips the path gate deliberately: asking for it by hand IS the decision.
Use it to redeploy the current commit, or to recover after a failed run.

> **Why `stage` is the repo's default branch.** GitHub only renders the **Run workflow** button when
> the workflow exists on the **default** branch. `.github/` lives on `stage` and nothing merges to
> `main`, so while `main` was the default the button silently did not exist — leaving a real
> backend-scope commit as the only way to deploy anything. Nothing in the UI explains this; it just
> isn't there. If the button ever disappears, check the default branch first.

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

   **Check Settings → Source even on an existing service.** A repo connection made at any point in
   the past survives everything else and is not undone by anything CI does — the symptom is two
   deployments per push, one CLI and one GitHub, and the cost is that the path gate stops meaning
   anything. The only source here should be the CI upload.

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
   STAGE_KYC_PROVIDER=persona                           # unset ⇒ identity verification OFF — a deployed tier has no default. Set it only to exercise the Persona sandbox; payers then meet the tier-2 gate again. NEVER `sim` here: stage is mainnet, and sim promotes to tier 2 with no documents
   STAGE_PERSONA_API_KEY=<persona_sandbox_… is fine on stage>   # BLANK BOTH = identity verification off (docs/14), NOT a boot failure
   STAGE_PERSONA_TEMPLATE_ID=<itmpl_… from Persona → Inquiry Templates>
   STAGE_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<KEY>   # mainnet RPC (Helius free tier)
   STAGE_HELIUS_API_KEY=<KEY>                            # push confirmation — see §Helius. Same key as the RPC URL above
   STAGE_HELIUS_WEBHOOK_SECRET=<openssl rand -hex 32>    # real values live in apps/backend/.env — NEVER paste one into this tracked file
   STAGE_FEE_PAYER_SECRET_KEY=[ ... ]                    # OPTIONAL — who pays gas (§Keys). Unset ⇒ sponsored mode (Privy pays user txs). JSON byte array ONLY
   STAGE_ESCROW_SECRET_KEY=[ ... ]                       # the escrow POOL's key — see §Keys below. Same JSON-array shape; ~0.05 SOL only when no fee-payer is set
   STAGE_PLATFORM_FEE_DESTINATION=<cold wallet pubkey>   # where the platform's cut lands on release. PUBLIC KEY ONLY
   STAGE_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v   # Circle's MAINNET USDC — this is the real-money switch
   PRIVY_APP_ID=<privy app id>                          # UNPREFIXED on every tier — one Privy app everywhere; STAGE_PRIVY_* is read by nothing (§One Privy app)
   PRIVY_APP_SECRET=<privy app secret>                  # backend-only, never in a web build; unprefixed too
   # PRIVY_VERIFICATION_KEY=<optional>                  # skips a network fetch per verify — same rule, unprefixed
   PUBLIC_BASE_URL=https://<this-railway-service>.up.railway.app   # → https://stage.api.frenspay.xyz once the custom domain is attached (step 6)
   STAGE_CORS_ORIGIN=<see below>
   STAGE_LP_BASE_URL=https://provider.frenspay.xyz   # LP console — alert deep links lose their button if unset
   # STAGE_TELEGRAM_BOT_TOKEN / STAGE_TELEGRAM_WEBHOOK_SECRET — one bot per tier, docs/13 §Setup.
   # Unset ⇒ the bot and its alert adapter are inert; the webhook fails closed.
   # STAGE_STAKE_TREASURY_ADDRESS — the stake capability switch; unset = /stake answers 503, nothing else changes.
   # Payments (quote → order) are ON only when ESCROW_SECRET_KEY + PLATFORM_FEE_DESTINATION are both usable
   # (`escrowLive`, docs/16); either missing ⇒ 503 payments_unavailable and one boot warning. The fee-payer only
   # picks who pays gas.
   ```
   Do **NOT** set `PORT` — Railway injects it and the server binds `process.env.PORT` (host-level
   vars stay unprefixed by convention, like `PUBLIC_BASE_URL`).

   **The fee-payer is a fresh keypair, never the devnet one** (that key lives in plaintext local
   files): `solana-keygen new --no-bip39-passphrase -o stage-mainnet-feepayer.json`, paste the JSON
   byte array as the value, fund the address with **~0.1 real SOL** (it sponsors every tx fee +
   ATA rent), and keep the file offline. It holds gas and nothing else — the platform's cut goes to
   `PLATFORM_FEE_DESTINATION`. One-time flip chores: delete the old devnet-era Helius webhook in the
   Helius dashboard (registration is idempotent **by URL**, so the stale one blocks re-registration),
   and optionally mark any pending devnet-era bridge rows failed in SQL (the poller retries them
   harmlessly).

   **§Keys — the escrow pool (docs/16).** Every payer deposit sits in ONE USDC token account owned by
   the escrow key until its order is released (partner gets `amount − fee`, the earnings wallet `fee`)
   or refunded (the payer gets it all back). The key signs those transfers out. **Who pays gas is one
   variable:** with `STAGE_FEE_PAYER_SECRET_KEY` set, the fee-payer pays everything and the escrow key
   holds no SOL; with it unset (stage today) the backend runs in **sponsored mode** — Privy pays user
   transactions (Privy dashboard → Gas Sponsorship → Solana must be ON; web only, the phone app
   refuses), and the escrow key pays its own gas for release/refund and new token accounts, so send it
   **~0.05 SOL**. The boot log says which mode it is. Stage's key was generated on the dev machine:
   ```
   solana-keygen new --no-bip39-passphrase -o stage-escrow.json      # never the fee-payer, never the stake treasury
   solana address -k stage-escrow.json                                # → EEvwiwTXQCaGpmF8BfYQzo9udbg1TNuyYmK7ob45vLEz is stage's (Bridge's key, 2026-08-31)
   ```
   Paste the file's contents — the `[ … ]` JSON array — as `STAGE_ESCROW_SECRET_KEY`, then move the file
   OUT of the repo and keep it offline (`*-escrow.json` and friends are gitignored, but a checkout is not a vault) (a lost key loses whatever is in the pool at that moment; there is no self-refund), and
   set `STAGE_PLATFORM_FEE_DESTINATION` to a cold wallet's public key. After the first deposit:
   `yarn workspace @fpay/backend check:pool` (DB + RPC) asserts _pool balance = Σ open orders_.
   Prod's key is Bridge's own — `DEPLOY.md §Keys`.
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
STAGE_CORS_ORIGIN=https://admin.frenspay.xyz,https://frenspay.xyz,https://www.frenspay.xyz,https://<web-domain>,https://<lp-domain>
```

A missing origin breaks that frontend in prod only, silently.

The admin origin appears in **both** environments' lists — stage's `STAGE_CORS_ORIGIN` above and
prod's bare `CORS_ORIGIN`. There is one admin console and it calls whichever backend the operator
selected, so each service has to allow that single origin independently.

## Helius — push confirmation

The confirmer poller already confirms transfers; Helius makes it push. The vars are in step 3. On
boot the backend auto-registers a webhook to `${PUBLIC_BASE_URL}/webhooks/helius` watching the
fee-payer (it signs every transfer). See `apps/backend/src/services/helius.ts`.

- `HELIUS_API_KEY` is the dashboard key (dashboard.helius.dev → the same key that's inside
  `SOLANA_RPC_URL`). It authenticates *us to Helius*, and is only ever sent by the backend.
- `HELIUS_WEBHOOK_SECRET` is ours, not Helius': `openssl rand -hex 32`. It authenticates *Helius to
  us*, and is registered as Helius' `authHeader`, so deliveries carry it as the `Authorization`
  header — never in the callback URL, which proxies, access logs and error trackers all record in
  plaintext. Unset ⇒ the route is open and logs a warning (dev only).
- Rotating the secret needs nothing but a variable change: boot finds the existing webhook by its
  callback path and PUTs the new config over it, so no stale duplicate is left delivering.

Note: registration always used the `enhanced` (mainnet) webhook type, so on devnet it was
effectively inert and the poller did the work — on mainnet it genuinely functions. A stale
devnet-era webhook on a *different* base URL (e.g. an old `*.up.railway.app` host) is not matched
by the path check above — delete that one in the Helius dashboard.

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

## Frontends → Vercel

The intended model was OMS's, **one Vercel project per app per environment**, and web has it:
`frenspay-stage` (Production Branch `stage`) and `frenspay-prod` (`sacred`). Admin, lp and landing
are **one project each, on `sacred`**. Measured from the GitHub commit statuses on 2026-09-06: every
stage push since 2026-08-15 cancelled those three at the gate, and every `stage` → `sacred` merge
built them. Vercel defaults a new project's Production Branch to the repo's default branch, which
is `sacred`, and nobody changed it. That is fine as long as `sacred` is only ever `stage` merged,
which it is: a stage push deploys web, the merge deploys the other three. Their `vercel.json` files
carry `git.deploymentEnabled: { stage: false }`, so Vercel no longer creates the doomed stage
deployment (it used to sit as "Building" in the Hobby queue behind web for up to 14 minutes before
the gate cancelled it, and read exactly like a prod deploy from a stage push).
Env vars live as each project's plain Production-env variables — no Preview-scoped juggling.
Ship to prod by merging `stage` → `sacred` (PR).

| project (Vercel name) | app | Production Branch | Root Directory | config file | domain |
| --- | --- | --- | --- | --- | --- |
| `frenspay-stage` | web, stage | `stage` | **`monorepo`** | root `vercel.json` (builds `@fpay/web`, output `apps/web/.next`) | the stage web domain |
| `frenspay-prod` | web, prod | `sacred` | **`monorepo`** | the same root file (`DEPLOY.md`) | app.frenspay.xyz (TBD) |
| `frenspay-admin` | admin, one project, both backends | `sacred` | `monorepo/apps/admin` | `apps/admin/vercel.json` | admin.frenspay.xyz |
| `merchants` | lp, one project | `sacred` | `monorepo/apps/lp` | `apps/lp/vercel.json` | provider.frenspay.xyz |
| `frenspay` | landing, one project | `sacred` | `monorepo/apps/landing` | `apps/landing/vercel.json` | frenspay.xyz |

To give admin or lp a real stage project later: create the twin with Production Branch `stage` and
delete the `git.deploymentEnabled` line from that app's `vercel.json` first. The file is shared by
both twins and it disables `stage` for both.

### Project setup — every step, per project

1. **Create**: Add New… → Project → import `unabrijed/frenspay`. Framework preset resolves to
   Next.js from the app's `vercel.json`; install/build commands come from that file too — never
   override them in the dashboard.
2. **Settings**:
   - **Git → Production Branch** per the table. Vercel defaults it to the repo's default branch
     (`sacred`); that default is how admin, lp and landing became sacred-only without anyone
     deciding it. A project builds only this branch (step 4), so a wrong value here is a project
     that never deploys from the branch you push.
   - **Build & Deployment → Root Directory** per the table. Web only: also turn **OFF "Include source files outside of
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
   on its **own** Production Branch — so one shared `vercel.json` pins `frenspay-stage` to `stage`
   and `frenspay-prod` to `sacred` without naming either. Nothing to set in the dashboard beyond
   the Production Branch itself (step 2). The gate prints its decision, so a cancelled deployment's
   log starts with why: `vercel-ignore: skip admin: VERCEL_ENV=preview on stage; ...`.

   If a project still has a hand-written **Ignored Build Step** from before this
   (`[ "$VERCEL_GIT_COMMIT_REF" = "stage" ] && exit 1 || exit 0`), **clear it** — `vercel.json`'s
   `ignoreCommand` overrides that field, so it is now dead config that reads as if it were live.
   The per-app `vercel.json` files also set `git.deploymentEnabled: { stage: false }`, so admin, lp
   and landing get no deployment at all on a stage push. The root file cannot (both web projects
   share it), so `frenspay-prod` still shows one that the gate cancels within seconds.
5. **Settings → Environment Variables** (plain Production env). Any change here is inert until the
   next deploy — `NEXT_PUBLIC_*` is inlined at build, and even runtime vars are baked into a
   deployment — so set variables, THEN deploy.

   web (stage):
   ```
   NEXT_PUBLIC_APP_ENV=stage
   NEXT_PUBLIC_STAGE_API_URL=https://stage.api.frenspay.xyz   # or the *.up.railway.app URL until the API domain exists
   NEXT_PUBLIC_STAGE_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com   # RPC provider only — every tier is mainnet
   NEXT_PUBLIC_PRIVY_APP_ID=<privy app id>                    # BARE on every tier — one Privy app everywhere; NEXT_PUBLIC_STAGE_PRIVY_* is read by nothing
   NEXT_PUBLIC_PRIVY_CLIENT_ID=<privy client id>
   NEXT_PUBLIC_STAGE_LANDING_URL=https://frenspay.xyz
   ```
   admin (the only admin project — it serves both environments):
   ```
   # NEXT_PUBLIC_APP_ENV is deliberately UNSET here — nothing but the dev shim reads it
   NEXT_PUBLIC_STAGE_API_URL=<same as web>                    # the "stage" target
   NEXT_PUBLIC_API_URL=https://api.frenspay.xyz               # the "prod" target
   NEXT_PUBLIC_PRIVY_APP_ID=<privy app id>                    # ONE app — every app, every tier
   NEXT_PUBLIC_PRIVY_CLIENT_ID=<privy client id>              # optional
   ```
   Admin's API **hosts** are targets, not tiers: both are inlined and the operator picks one in the
   sidebar, which is why there is no admin twin project. The **Privy app is not per-target, and not per-tier** — there is
   exactly one, so every frontend reads it under its BARE name on every tier and the same id must be
   the backend's `PRIVY_APP_ID` on every tier (unprefixed; `STAGE_PRIVY_APP_ID` is read by nothing
   since 2026-08-31 — §One Privy app below), or whichever backend disagrees refuses every token
   before a row is looked up. It used to be one
   app per target; the switch swapped the id under its reload, the incoming app inherited the
   outgoing app's stored token (Privy's keys are not app-scoped), and the console hung on
   "Signing in…". Full reasoning: `apps/admin/README.md` §Deploy.
   landing (only if a stage landing twin exists; the one `frenspay` project is prod, see `DEPLOY.md`):
   ```
   NEXT_PUBLIC_APP_ENV=stage
   NEXT_PUBLIC_STAGE_API_URL=<same as web>                    # POST /waitlist — code + email — posts here
   ```
   Set `NEXT_PUBLIC_STAGE_APP_URL=https://<stage-web-domain>` for the signup OTP handoff and
   Launch app link. It must target the web deployment using the same stage backend.
   lp (stage) — the LP console; the backend calls it "merchants", `/merchants/*`:
   ```
   NEXT_PUBLIC_APP_ENV=stage
   NEXT_PUBLIC_STAGE_API_URL=<same as web>
   NEXT_PUBLIC_STAGE_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com   # deployed tiers fail closed to mainnet anyway; set it for parity
   NEXT_PUBLIC_PRIVY_APP_ID=<same privy app id as web>                    # bare on every tier; staking signs a real USDC transfer, so it needs the embedded wallet
   NEXT_PUBLIC_PRIVY_CLIENT_ID=<privy client id>                          # optional
   STAGE_ACCESS_KEY=<openssl rand -hex 32>                                # LP deployment gate; customer web uses email login
   ```
   Nothing else: no landing link, and the dev
   identity (`*_DEV_USER_ID`) is only read when `NODE_ENV !== 'production'` — never in a build.
6. **Deploy**: push `stage` (or Deployments → Redeploy). Watch the log: install and build must run
   the `vercel.json` commands verbatim, and web must get past the post-build step (the historical
   crash below) to READY.
7. **Domain**: Settings → Domains → add the app's domain, publish the CNAME Vercel shows at the
   DNS provider. THEN add the new origin to the backend's `STAGE_CORS_ORIGIN` list (§CORS) — a
   missing origin breaks that frontend silently. If the landing domain ever changes, update
   `NEXT_PUBLIC_STAGE_LANDING_URL` (web) and `STAGE_LANDING_URL` (backend) to match.
8. **Test**, per app:
   - **web**: email OTP opens the existing UI for invited f-list members. A nonmember sees inline
     invite entry. Test the landing handoff, returning login, and Invite a fren after reload.
     For the legacy payment mode only, the real smoke test (real money, keep it small): onboarding skips
     the fund step straight to Home ($0) → Add money shows the Solana deposit address (no faucet,
     no EVM chips) → send it ~$2 real USDC from an exchange/wallet → balance appears (Helius push
     or poller) → `/sim/kyc` to tier 2 → a small P2P or external send, verified on Solscan. Network
     tab open throughout — every API call goes to the stage API origin, no CORS errors.
   - **admin**: loads (no gate configured), Privy login works, and a non-admin account is refused
     by the backend (`role='admin'` is checked server-side). The stage/prod switch renders as soon
     as `NEXT_PUBLIC_API_URL` is set. Switch to prod and back: one login covers both, so each side
     should land in a working console without re-signing in, never on a spinner. "No profile here"
     means only what it says — that database has no row for the account yet.
   - **landing**: an invite link autofills the code; submitting code + email joins the f-list
     and opens the app at email OTP. Launch app also reaches the configured web origin.
   - **lp**: the domain serves its access-key form (HTTP 401) until the device presents the key.
     The right key lands on the path that was asked for: open `/identity?inquiry-id=x` on a fresh
     device, enter the key, and the URL must keep its query (the vendor return polls only while it is
     there); a Telegram alert button (`/orders/:id`) behaves the same. Then Privy email login (same
     app as web — an account created on web signs straight in) → apply → stake.

### Deploy access gate (LP only)

The LP console retains `src/middleware.ts`, `/gate`, its `STAGE_ACCESS_KEY` / `ACCESS_KEY`, and
its httpOnly `fpay_gate` cookie. Deployed LP environments fail closed without a configured key.
`yarn check:gate` validates its same-origin redirect handling.

Customer web uses email OTP + invited f-list membership in both existing modes. Remove obsolete
customer access-key variables after deploying the new build. Deploy backend support before web
and landing; set the landing app URL to the web origin using the same backend. See the email and
invite rollout in `DEPLOY.md` for the verification sequence.

### One Privy app, every tier — and what changing it does to existing accounts

There is exactly one Privy app. Every frontend reads it under its bare name on every tier
(`NEXT_PUBLIC_PRIVY_APP_ID` / `_CLIENT_ID`; `EXPO_PUBLIC_…` on the phone) and the backend verifies
with the bare `PRIVY_APP_ID` / `PRIVY_APP_SECRET` on every tier — none of them go through the tier
chain, so a `STAGE_PRIVY_*` twin is read by nothing. (They used to; a stale one is how stage kept
mailing OTPs from a retired app.) The backend boot line prints `privy=<app id>`; `(unset)` means
Privy is off, loudly, with no fallback.

**Pointing a tier at a different Privy app is an identity migration, not a variable edit.** Privy
DIDs and embedded wallets are per-app. An account minted under the old app comes back under the new
one with a NEW `did:privy:…` and a NEW embedded Solana address:

- `/auth/sync` adopts the existing row by its Privy-verified email (`upsertUserByPrivyDid`) — handle,
  ledger, partner row and invite lineage survive — then the wallets upsert **overwrites the Solana
  address**; `wallets` keeps no history, only `transfers` remembers the old one. **USDC at the old
  address is reachable only through the old app.** Snapshot `select user_id, address from wallets`
  and sweep balances BEFORE flipping the variables.
- What people see: web signs them out (their DID is unknown → 401); the next sign-in reaches the
  handle step, which first syncs with no handle — the server adopts by verified email and they land
  on Home without typing anything (since 2026-09-01; before that their own handle read as taken and
  they had to type any free one). The LP console does the same on its **Finish setting up** screen
  ("Welcome back, @…"; before 2026-09-01 it dead-ended, and the only way in was the payer app's
  gate key). Only a Privy read failure at that moment falls back to asking for a name. Adoption also moves a partner's release address (`merchants.treasury_address`)
  to the new wallet when it equalled the old one — the stake refund already reads the live wallet —
  so releases after a flip stay spendable. A partner who adopted via web BEFORE that shipped keeps
  the stale address: review, then re-point by hand — `update merchants m set treasury_address =
  w.address from wallets w where w.user_id = m.user_id and w.chain = 'solana' and m.sim_behavior
  is null and m.treasury_address <> w.address`.
- Before any deploy, on the surviving app's dashboard: allowed origins (web, lp, admin, the
  localhost ports), email-only login, Solana embedded wallets ON, **Gas Sponsorship → Solana ON**
  (stage runs in sponsored mode — with it off, login works and every send fails), and an app client
  for `com.bridge.fpay` if the phone matters on that tier.
- Flip every host variable while nothing is deployed (they are inert until the next build), then ONE
  push — Railway and Vercel build in parallel and the 1–2 minute skew is a pure 401 window; nothing
  reaches the database without a verified token, in either order.

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
machine: a secret scan; a check that every path the root `Dockerfile` copies out of the builder still
exists in the tree (the hook does not build the image — a deleted IDL directory failed the stage image
after a push on 2026-08-31); `yarn install --frozen-lockfile`; then the landing/web/admin/lp builds (each
app's Vercel buildCommand verbatim); then `yarn workspace @fpay/backend tsc --noEmit` and
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
| **Two deployments per push** — one labelled CLI, one labelled GitHub | The service is connected to the GitHub repo *as well as* receiving CI's upload, so one push fires both paths. Railway → `frenspay-stage` → Settings → Source → disconnect the repo. Worth fixing immediately: Railway's own trigger knows nothing about the path gate, so while it is connected a **docs-only push still deploys** and every "docs deploy nothing" guarantee here is false. It also doubles build usage and races two builds of the same commit. |
| Workflow never ran | The change was outside the backend scope. Check with `node scripts/vercel-ignore.mjs backend; echo $?`. Ship it anyway with Actions → Run workflow, which skips the gate deliberately. |
| No **Run workflow** button on the Actions page | The workflow isn't on the repo's **default** branch — that is the only place GitHub looks for `workflow_dispatch`. `stage` must stay the default branch (Settings → General). |
| `Failed to upload code with status code 404 Not Found` | `RAILWAY_STAGE_SERVICE` names a service that doesn't exist in this environment. The `railway status` output printed just above it lists the real names under `All resources` — copy one exactly. This is the most likely cause by far; the 404 is Railway's answer for "no such target", not for a bad token. |
| `railway up` fails: unauthorized | `RAILWAY_STAGE_TOKEN` missing, expired, or scoped to the wrong environment. It must be a **project** token for **stage**. An account token (from Account Settings) is read from `RAILWAY_API_TOKEN`, carries no project, and makes `railway status` fail to resolve one. |
| Deploy stuck "waiting for healthcheck" | `PORT` was set by hand (never set it — Railway injects it), or the server crashed at boot. The deploy logs carry the real error. |
| Boot throws on KYC config | Only one config still does this: a `persona_sandbox_…` key on a **production** tier. Blank credentials are no longer an error — they mean the vendor is off (`config.personaLive`), the app boots, `/kyc/verify` 503s and partner onboarding falls back to manual review (docs/14). Do **not** answer any KYC problem with `STAGE_KYC_PROVIDER=sim` — stage is mainnet, and sim self-promotes. |
| `/kyc/verify` returns 503 `kyc_unavailable` | The service booted fine (so the vars are set) and the **call to Persona** was rejected. The boot log's `persona probe:` line and the `kyc provider start failed` line carry `[template=… key=len…####]` — see the KYC runbook in `docs/10-ops-and-roadmap.md`. |
| `prepared statement does not exist` / lock hangs | `STAGE_DATABASE_URL` points at the transaction pooler (`:6543`). It must be the **session** pooler (`:5432`). |
| Build fails on an unpublished `@fpay/*` package | A new workspace's `package.json` isn't COPY'd before the install layer in the root `Dockerfile`. Its header explains why; add the line. |
| `Cannot find package '@fpay/shared'` at runtime | A *value* import of `@fpay/shared` reached the bundle, where it is external. Make it `import type`. |
| CORS errors from the app | `STAGE_CORS_ORIGIN` doesn't list the origin — §CORS. |
