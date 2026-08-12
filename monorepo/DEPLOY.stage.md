# Stage deploy — backend → Railway, frontends → Vercel (Solana devnet)

Backend: Fastify (`apps/backend`) on Railway, stage environment, devnet USDC. DB is Supabase
Postgres. Frontends: per-environment Vercel projects (the OMS model — see §Frontends).
Prod/mainnet is a separate doc: `DEPLOY.md`.

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
   STAGE_SOLANA_RPC_URL=https://api.devnet.solana.com   # or a Helius devnet URL
   STAGE_FEE_PAYER_SECRET_KEY=[ ... ]                    # JSON byte array — copy from .env
   STAGE_USDC_MINT=<copy from .env>                      # official Circle devnet USDC
   STAGE_PRIVY_APP_ID=<privy app id>
   STAGE_PRIVY_APP_SECRET=<privy app secret>            # backend-only, never in a web build
   PUBLIC_BASE_URL=https://<this-railway-service>.up.railway.app   # → https://stage.api.frenspay.xyz once the custom domain is attached
   STAGE_CORS_ORIGIN=<see below>
   ```
   The fee-payer secret, USDC mint, and a funded fee-payer wallet already exist locally from
   `yarn devnet:setup` (`apps/backend/.devnet/keys.json`) — copy those values up. The fee-payer
   needs a little devnet SOL.
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

## CORS

`CORS_ORIGIN` empty = allow-all (dev convenience). The moment it's set, it must be the FULL
comma-separated list of EVERY browser origin that calls the API:

```
STAGE_CORS_ORIGIN=https://admin.frenspay.xyz,https://frenspay.xyz,https://www.frenspay.xyz,https://<web-domain>
```

A missing origin breaks that frontend in prod only, silently.

## Optional: Helius — faster confirmation

The confirmer poller already confirms transfers, so this is optional. To enable push confirmation:
```
STAGE_SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=<KEY>
STAGE_HELIUS_API_KEY=<KEY>
STAGE_HELIUS_WEBHOOK_SECRET=<random secret>
```
On boot the backend auto-registers a webhook to `${PUBLIC_BASE_URL}/webhooks/helius` watching the
fee-payer (it signs every transfer). See `apps/backend/src/services/helius.ts`.

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

Web is behind a **deploy access gate** (`apps/web/src/middleware.ts`): set `STAGE_ACCESS_KEY` on the
stage project to a fresh `openssl rand -hex 32`. Every route then serves a key form until the device
presents the key once (year-long cookie). Unset = gate off. The prod twin sets bare `ACCESS_KEY`
with a **different** key (`DEPLOY.md`). Rotate the var to evict every device on that environment.

| project | Production Branch | Root Directory | config file |
| ------- | ----------------- | -------------- | ----------- |
| web (stage) | `stage` | **`monorepo`** | root `vercel.json` (builds `@fpay/web`, output `apps/web/.next`) |
| admin (stage) | `stage` | `monorepo/apps/admin` | `apps/admin/vercel.json` |
| landing (stage, optional) | `stage` | `monorepo/apps/landing` | `apps/landing/vercel.json` |

### Branch pin — each project builds ONLY its own branch

Both env projects share one `vercel.json`, so the pin can only live in the dashboard. Two ways,
either works:

**A (preferred, if the toggle exists):** Settings → Git (or Settings → Environments → Preview) →
disable **Preview Deployments**. Only the Production Branch ever builds after that.

**B (works everywhere):** Settings → Git → **Ignored Build Step** → select the custom/Bash-script
option and paste ONE line. Exit codes are inverted from intuition: **exit 1 = BUILD, exit 0 = SKIP.**

Stage projects (build only `stage`):

```bash
[ "$VERCEL_GIT_COMMIT_REF" = "stage" ] && exit 1 || exit 0
```

Prod projects (build only `sacred`):

```bash
[ "$VERCEL_GIT_COMMIT_REF" = "sacred" ] && exit 1 || exit 0
```

Other invariants on EVERY project (dashboard):
- **Skip deployment for unaffected projects: Enabled** (under Root Directory). Path scoping is
  Vercel's built-in workspace-graph detection — deliberately NO `ignoreCommand`s in the repo
  (web/admin also rebuild on `packages/shared`; landing only on its own dir). Known fail-open:
  root-level changes (docs, lockfile) may build all frontends of the matching branch.
- **Node.js Version: 24** (`@solana-program/token` engine floor; `.yarnrc` ignore-engines masks it
  at install, set it anyway for runtime parity).
- Web only: **Include source files outside of the Root Directory: OFF** (under Root Directory).
  Root cause of `noop.js` → `Cannot find module …server.runtime.prod.js`: with the toggle ON,
  `/vercel/path0` is the *git* root (`payments/`), but `next build` records the app dir relative
  to `outputFileTracingRoot` (the monorepo — pinned in `apps/web/next.config.ts`), so
  `@vercel/next` resolves Next from `/vercel/path0/apps/web`, which doesn't exist. OFF makes
  `/vercel/path0` = the monorepo and the roots coincide. (`noop.js` is `resolve-from`'s synthetic
  module name, not a real file — the crash is the same in any Root Directory pattern.)
- Admin can't use that toggle (its Root Directory is the app dir; install/build need the workspace
  root above it) and WILL hit the same crash on its first deploy. Fix then: set admin's
  `outputFileTracingRoot` to the git root (`payments/`) so its recorded app dir becomes
  `monorepo/apps/admin`.

## Pre-push build gate

`monorepo/.githooks/pre-push` builds EVERYTHING on every push — only successful builds leave the
machine: `yarn install --frozen-lockfile`, then the landing/web/admin builds (each app's Vercel
buildCommand verbatim), then `yarn workspace @fpay/backend tsc --noEmit` (Railway has no build
step, so the typecheck is the only gate before a type error crashes the server at boot). It also
asserts every `vercel.json` ignoreCommand fails open (exit 1) on an unreachable SHA.

Enable once per clone (git config, not a committed setting):

```
git config core.hooksPath monorepo/.githooks
```

Bypass deliberately with `git push --no-verify`.
