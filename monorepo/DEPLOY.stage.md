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

## Build model

- **Trigger**: pushing **`stage`** auto-deploys the stage environment (branch is the environment's
  deploy trigger, dashboard setting). Path isolation is `build.watchPatterns` in the root
  `railway.json`: backend code, `packages/shared`, the workspace manifests/lockfile, and the root
  build files (`Dockerfile`, `.dockerignore`, `railway.json`). Any other path skips the deploy.
- **Build**: the repo-root **`Dockerfile`** (root `railway.json` pins `builder: DOCKERFILE` + the
  `/health` healthcheck): `node:24-slim` (web's `@solana-program/token@0.14` needs node ≥24 and the
  image installs every workspace), `yarn install --frozen-lockfile` at `monorepo/` (the
  workspace root), then `db:deploy && start` as the container CMD — migrations run before the
  server, and the backend runs TS via `tsx` with no build step. The root `.dockerignore` keeps
  secrets (`.env*`, `.devnet/`) and dead weight out of the image — keep it that way when adding files.

> **Troubleshooting: build log shows `nix-env` / Nixpacks errors** (e.g.
> `undefined variable 'nodejs_22'`) ⇒ the service's **Root Directory is set** in the dashboard,
> which hides the repo-root `Dockerfile` + `railway.json` and drops Railway back to Nixpacks.
> Settings → Source → clear Root Directory, redeploy. A correct build opens with `FROM node:24-slim`.

## Service setup

1. New Railway **service** from the GitHub repo (`unabrijed/frenspay`), deploy branch **`stage`**,
   in the **stage** environment. **Leave Root Directory unset** (see troubleshooting above).
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
4. Deploy. Migrations auto-apply at boot — `railway.json` runs `db:deploy` before `start`, so the
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

## Helius — push confirmation

The confirmer poller already confirms transfers; Helius makes it push. The vars are in step 3. On
boot the backend auto-registers a webhook to `${PUBLIC_BASE_URL}/webhooks/helius` watching the
fee-payer (it signs every transfer). See `apps/backend/src/services/helius.ts`.

Note: registration always used the `enhanced` (mainnet) webhook type, so on devnet it was
effectively inert and the poller did the work — on mainnet it genuinely functions. If a stale
devnet-era webhook exists at the same URL, delete it in the Helius dashboard first (registration
is idempotent by URL and would report "already registered").

## Required once the console has more than one operator: root admins

```
STAGE_ADMIN_EMAILS=unabrijed@gmail.com
```

Comma-separated Privy login addresses that are admin regardless of `users.role`, and that the
console refuses to demote. Everyone else is promoted from Admin → Users. This exists as the lockout
recovery path: the demote guards mean a bad click can't strip the last admin, and if one somehow
does, the env var still lets someone in without a psql session.

Matched against `users.email`, which `/auth/sync` now fills from Privy — so an operator has to have
signed into the app at least once before the match can work.

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
| admin (stage) | `stage` | `monorepo/apps/admin` | `apps/admin/vercel.json` |
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
   - **Skip deployment for unaffected projects: Enabled**. Path scoping is Vercel's built-in
     workspace-graph detection — deliberately NO `ignoreCommand`s in the repo (web/admin also
     rebuild on `packages/shared`; landing only on its own dir). Known fail-open: root-level
     changes (docs, lockfile) may build all frontends of the matching branch.
3. **Settings → Git — branch pin**, so each project builds ONLY its own branch. Both env projects
   share one `vercel.json`, so the pin can only live in the dashboard. Two ways, either works:
   - **A (preferred, if the toggle exists)**: Settings → Git (or Settings → Environments →
     Preview) → disable **Preview Deployments**. Only the Production Branch ever builds.
   - **B (works everywhere)**: Settings → Git → **Ignored Build Step** → the custom/Bash-script
     option, ONE line. Exit codes are inverted from intuition: **exit 1 = BUILD, exit 0 = SKIP.**
     ```bash
     [ "$VERCEL_GIT_COMMIT_REF" = "stage" ] && exit 1 || exit 0
     ```
     (Prod projects pin `sacred` the same way — `DEPLOY.md`.)
4. **Settings → Environment Variables** (plain Production env). Any change here is inert until the
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
   admin (stage):
   ```
   NEXT_PUBLIC_APP_ENV=stage
   NEXT_PUBLIC_STAGE_API_URL=<same as web>
   NEXT_PUBLIC_STAGE_PRIVY_APP_ID=<privy app id>
   NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID=<privy client id>
   ```
   landing (stage):
   ```
   NEXT_PUBLIC_APP_ENV=stage
   NEXT_PUBLIC_STAGE_API_URL=<same as web>                    # the waitlist + /invite/check post here
   NEXT_PUBLIC_STAGE_APP_URL=https://stage.frenspay.xyz       # where a valid invite code hands off
   ```
   Without `NEXT_PUBLIC_STAGE_APP_URL` the invite gate falls back to `http://localhost:3000`, so
   every accepted code on a deployed landing page sends the visitor nowhere. Set it with the others.
5. **Deploy**: push `stage` (or Deployments → Redeploy). Watch the log: install and build must run
   the `vercel.json` commands verbatim, and web must get past the post-build step (the historical
   crash below) to READY.
6. **Domain**: Settings → Domains → add the app's domain, publish the CNAME Vercel shows at the
   DNS provider. THEN add the new origin to the backend's `STAGE_CORS_ORIGIN` list (§CORS) — a
   missing origin breaks that frontend silently. If the landing domain ever changes, update
   `NEXT_PUBLIC_STAGE_LANDING_URL` (web) and `STAGE_LANDING_URL` (backend) to match.
7. **Test**, per app:
   - **web**: the domain serves the access-key form (HTTP 401) on every route; a wrong key shows
     the inline error; the right key lands in the app and a reload skips the form (device cookie).
     Then the real smoke test (real money, keep it small): Privy email login → onboarding skips
     the fund step straight to Home ($0) → Add money shows the Solana deposit address (no faucet,
     no EVM chips) → send it ~$2 real USDC from an exchange/wallet → balance appears (Helius push
     or poller) → `/sim/kyc` to tier 2 → a small P2P or external send, verified on Solscan. Network
     tab open throughout — every API call goes to the stage API origin, no CORS errors.
   - **admin**: loads (no gate configured), Privy login works, and a non-admin account is refused
     by the backend (`role='admin'` is checked server-side).
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
buildCommand verbatim), then `yarn workspace @fpay/backend tsc --noEmit` (Railway has no build
step, so the typecheck is the only gate before a type error crashes the server at boot).

Enable once per clone (git config, not a committed setting):

```
git config core.hooksPath monorepo/.githooks
```

Bypass deliberately with `git push --no-verify`.
