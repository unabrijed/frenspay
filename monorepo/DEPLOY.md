# Deploy — wallet-to-wallet USDC (Solana devnet)

Goal: host the backend + web so two people on two devices can sign up (Privy) and send USDC to each
other. **Devnet** (real on-chain, test USDC via the faucet). No merchant, no cross-chain. Mainnet is a
separate later step (bottom of this doc).

Services:
- **Backend** — Fastify on **Railway** (`apps/backend`, `railway.json` already configured).
- **Web** — Next.js 15 on **Vercel** (`apps/web`, `vercel.json` added).
- **Admin** — Next.js 15 on **Vercel** (`apps/admin`), the operator console at `admin.frenspay.xyz` (§2b).
- **Landing** — static Next.js on **Vercel** (`apps/landing`, root directory `monorepo/apps/landing`).
- **DB** — Supabase Postgres (stage). `STAGE_DATABASE_URL` = the **session pooler** URL — see §1 step 2.

**Deploy isolation:** each Vercel project's `vercel.json` carries an `ignoreCommand` that diffs
`$VERCEL_GIT_PREVIOUS_SHA` (last successful deploy) against the project's own directory — plus
`packages/shared` + the workspace `yarn.lock` for the monorepo apps — so a commit to one app no
longer rebuilds the others. All three web apps are now yarn workspaces under `monorepo/apps/`, so
their configs are identical apart from the workspace name (landing omits `packages/shared` — it
mirrors the design tokens by hand, see `globals.css`).

The `git cat-file -e` in front of each diff and the `|| exit 1` after it are both load-bearing, do
not "simplify" either away. Vercel clones with `--depth=10`, and neither a failed nor a skipped
deploy advances `$VERCEL_GIT_PREVIOUS_SHA` — so a run of skips longer than ten commits puts that SHA
outside the shallow clone, `git diff` dies on `fatal: bad object`, and the deploy errors at the
ignore step before it ever installs. The `cat-file` guard turns that into a plain build (unresolvable
SHA ⇒ can't prove nothing changed ⇒ build), which then succeeds and resets the SHA to HEAD, so the
gap closes itself. The `|| exit 1` matters because git signals that failure with **128**, and only
`0` (skip) and `1` (build) are documented codes — 128 is what took the deploy down in the first
place, so every non-zero path is normalised to 1. Net effect: unset, empty, unreachable, or any
other git error all build. Railway has no in-repo equivalent: set **Watch Paths** in
the service dashboard (Settings → Watch Paths) to `monorepo/apps/backend/**` and
`monorepo/packages/shared/**` so web/admin/landing commits stop redeploying the backend.

**Build gate before push:** `monorepo/.githooks/pre-push` refuses a push that would not deploy. It
diffs what you are pushing against the remote and runs only what that touches, using the same watched
paths as the `ignoreCommand`s above:

| Touched | Runs |
| ------- | ---- |
| any `package.json` / `yarn.lock` | `yarn install --frozen-lockfile` — a stale lockfile fails the deploy but a warm local `node_modules` hides it |
| `apps/<app>/` (+ `packages/shared/` for web/admin) | `yarn workspace @fpay/<app> build` — the app's own `buildCommand`, verbatim |
| `apps/backend/`, `packages/shared/` | `yarn workspace @fpay/backend tsc --noEmit` — Railway has no build step, so this is the only gate before a type error crashes the server at boot |
| any `apps/*/vercel.json` | each `ignoreCommand` must exit **1** on an unreachable SHA — enforces the two paragraphs above, which no build could ever catch because the ignore step runs first |

Enable it once per clone (it is git config, not a committed setting):

```
git config core.hooksPath monorepo/.githooks
```

Bypass deliberately with `git push --no-verify`. Note it builds the **working tree**, not the commits
being pushed — identical on a clean tree, which is the only state you should be pushing from anyway.

> **Landing moved.** It used to live at `landing/`, outside the workspace, with its own lockfile.
> The existing Vercel project must be re-pointed once: **Settings → General → Root Directory**,
> `landing` → `monorepo/apps/landing`. Same project, so `frenspay.xyz` and `NEXT_PUBLIC_API_URL`
> carry over untouched. Do this **before** the move lands on the deployed branch, or the next
> build fails on a missing directory.

Env convention: backend runs with `NODE_ENV=stage` → reads `STAGE_*` keys (see `apps/backend/.env.example`).
A web production build reads unprefixed `NEXT_PUBLIC_*` (see `apps/web/.env.example`). `PORT` and
`PUBLIC_BASE_URL` are host-level (unprefixed).

**Environments (Railway):** one project, two Railway environments — `stage` and `production`. Each
environment carries `NODE_ENV` + its own variables and nothing else differs: the start command is
identical everywhere because `envConfig` keys off `NODE_ENV` (stage→`STAGE_*`, prod→bare). No
per-env scripts. Branch map: pushing **`stage`** auto-deploys the stage environment; **`sacred`** is
the prod branch, wired to the `production` environment only at mainnet time — until then a `sacred`
push deploys nothing.

---

## 1. Backend → Railway

1. New Railway **service** from the GitHub repo (`unabrijed/frenspay`), deploy branch **`stage`**, in
   the **stage** environment. Root directory: `monorepo` (the yarn workspace root). Builder
   is **Nixpacks** (no Dockerfile). Start command + healthcheck come from `apps/backend/railway.json`
   (`yarn workspace @fpay/backend db:deploy && … start`, `/health`) — point the service's
   config-as-code path at it, or paste those two values into the dashboard. Node is pinned to 22 via
   `.nvmrc`.
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
   STAGE_USDC_MINT=<copy from .env>                      # official Circle devnet USDC (the old custom vsL2t… mint is dead)
   STAGE_PRIVY_APP_ID=<privy app id>
   STAGE_PRIVY_APP_SECRET=<privy app secret>            # backend-only, never in the web build
   PUBLIC_BASE_URL=https://<this-railway-service>.up.railway.app
   STAGE_CORS_ORIGIN=https://<your-web-domain>          # fill in after step 2 (Vercel URL)
   ```
   The fee-payer secret, USDC mint, and a funded fee-payer wallet already exist locally from
   `yarn devnet:setup` (`apps/backend/.devnet/keys.json`) — copy those values up. The fee-payer needs a
   little devnet SOL (it already holds ~10).
4. Deploy. Migrations auto-apply at boot — `railway.json` runs `db:deploy` before `start`, so the
   server can never come up against a stale schema. To apply by hand instead:
   ```
   yarn db:migrate   # applies pending apps/backend/src/db/migrations/*.sql
   ```
   (Run locally with `STAGE_DATABASE_URL` pointed at the Supabase session pooler, or via Railway's
   shell. `db:status` shows what's applied/pending.)
5. Verify: `curl https://<backend>/health` → `{"status":"ok","database":"configured"}`.

## 2. Web → Vercel

1. New Vercel project from this repo. **Root Directory: `monorepo/apps/web`** (the git repo root is
   `payments/`, one level above the monorepo; Vercel auto-detects the yarn workspace and installs at
   `monorepo/`). `apps/web/vercel.json` pins framework + the workspace build.
2. Production **Environment Variables** (read at build time, inlined by Next):
   ```
   NEXT_PUBLIC_API_URL=https://<backend>.up.railway.app
   NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
   NEXT_PUBLIC_PRIVY_APP_ID=<same privy app id as backend>
   NEXT_PUBLIC_LANDING_URL=https://frenspay.xyz
   ```
   (`NODE_ENV=production` is set by Vercel automatically → the app reads the unprefixed keys above.)
3. Deploy → note the URL (e.g. `https://pay.vercel.app`).
4. Go back to Railway and set `STAGE_CORS_ORIGIN` (see §2c — it must list EVERY browser origin).

## 2b. Admin console → Vercel (admin.frenspay.xyz)

The operator console (`apps/admin`) is deliberately its own app + deploy so ops code never ships in
the consumer bundle. Same backend, same Privy app; authorization is server-side (`role='admin'` —
everyone else gets a 403 screen).

1. New Vercel project from this repo. **Root Directory: `monorepo/apps/admin`**.
   `apps/admin/vercel.json` pins framework + `yarn workspace @fpay/admin build` + deploy isolation.
2. Production **Environment Variables**:
   ```
   NEXT_PUBLIC_API_URL=https://<backend>.up.railway.app
   NEXT_PUBLIC_PRIVY_APP_ID=<same privy app id as backend>
   ```
3. **Domain**: add `admin.frenspay.xyz` to the project. DNS: CNAME `admin` → `cname.vercel-dns.com`.
4. Seed the operator (once, by hand — same as before):
   `update users set role='admin' where handle='@you';`
5. Schema: nothing to run — migrations auto-apply on deploy (`db:deploy` in the start command).
6. Local dev: `yarn dev:admin` → console on :3002 + backend on :3001. Without Privy configured it
   uses the `x-dev-user-id` shim — set `NEXT_PUBLIC_LOCAL_DEV_USER_ID` in `apps/admin/.env.local`
   to a seeded user id that carries `role='admin'` (admin writes FK the audit trail to it).

## 2c. CORS — every browser origin, or things break in prod only

`CORS_ORIGIN` empty = allow-all (dev convenience). The moment it's set, it must be the FULL
comma-separated list — the admin console AND the landing page (its waitlist form POSTs cross-origin
to `/waitlist`) AND the web app:

```
STAGE_CORS_ORIGIN=https://admin.frenspay.xyz,https://frenspay.xyz,https://www.frenspay.xyz,https://<web-domain>
```

Forgetting the landing origins silently breaks the f-list form in prod while everything works
locally. The landing project itself needs two env vars: `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_APP_URL` (the deployed web app — every "try the demo" link points there and relays a
cached `?ref=@handle` across to signup; unset makes those links inert). Both are baked into the
static export at build time, so changing either requires a landing redeploy.

## 2d. F list — referral loop + confirm email

Schema: nothing to run — migrations auto-apply on deploy (`db:deploy` in the start command).

**Backend vars** (all four, or nothing happens):

```
STAGE_RESEND_API_KEY=re_...
STAGE_EMAIL_FROM=fpay <frens@frenspay.xyz>
STAGE_WAITLIST_SECRET=<openssl rand -hex 32>
STAGE_LANDING_URL=https://frenspay.xyz
```

Unset is a deliberate, safe state: no share codes are minted, no mail is sent, and `/waitlist` keeps
accepting signups exactly as before. So this ships fine *before* DNS is ready. `RESEND_API_KEY`
without `WAITLIST_SECRET` logs a boot warning and stays disabled — a token minted with an empty HMAC
key could be forged.

**Resend DNS** (resend.com → Domains → add `frenspay.xyz`) — publish the records it shows, then hit
Verify. Until the domain verifies, every send 403s and the failure is logged, not raised:

| Type  | Name                | Value                    |
| ----- | ------------------- | ------------------------ |
| TXT   | `send`              | `v=spf1 include:amazonses.com ~all` |
| CNAME | `resend._domainkey` | (the DKIM value Resend shows) |

Free tier is 3,000/month, 100/day — well past what an f list needs.

**Web app var**: `NEXT_PUBLIC_STAGE_LANDING_URL=https://frenspay.xyz`. This is where the settings
"Share invite" link now points (it used to point at the app's own origin) and where the invite-gate
dead end sends people who have no code. Defaults to `https://frenspay.xyz` if unset.

`WAITLIST_SECRET` is write-once in practice: rotating it invalidates every outstanding confirm link
and re-mints everyone's share code, so any link already shared stops attributing.

## 3. Privy dashboard

In the Privy app (`Settings → Allowed origins`): add the deployed web origin (`https://pay.vercel.app`)
and the admin console (`https://admin.frenspay.xyz`) alongside `http://localhost:3000` and
`http://localhost:3002`. Ensure **Email login** + **Solana embedded wallets** are enabled (and
**Passkey** if you want the in-app "add a second device" recovery to work). The admin app never
creates wallets (`createOnLogin: 'off'`) — it only uses Privy for identity.

## 4. (Optional) Helius — faster confirmation

The confirmer poller already confirms transfers, so this is optional. To enable push confirmation:
```
STAGE_SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=<KEY>
STAGE_HELIUS_API_KEY=<KEY>
STAGE_HELIUS_WEBHOOK_SECRET=<random secret>
```
On boot the backend auto-registers a webhook to `${PUBLIC_BASE_URL}/webhooks/helius` watching the
fee-payer (it signs every transfer). See `apps/backend/src/services/helius.ts`.

## 5. Verify the live P2P loop

1. Open the web URL on two devices / two browser profiles; sign up two Privy accounts (A and B) with
   distinct handles.
2. Each taps **Add** to faucet some devnet USDC; Home shows a real balance.
3. B opens **Receive** (center Scan button → "Show my QR", or Home). A taps **Scan** → points at B's QR
   (or **Send** → types `@B`) → enters an amount → sends.
4. A sees "Sent"; **B's balance + activity update within ~12s with no manual refresh** (live-sync), and
   the row goes pending → confirmed.

---

## Mainnet later (not built)

Going to real money is a deliberate, separate step. The full bare-name variable list for the
`production` environment lives in `apps/backend/.env.production.example` — same start command as
stage, only the variables differ. The checklist:
- Use **Circle's USDC mint** (`EPjFWdd5...`) and a **mainnet RPC** (Helius mainnet).
- **Disable the faucet** — `/devnet/faucet` is already gated to `config.isDevelopment`; ensure prod isn't
  flagged development. Funding becomes **deposit-only** (the existing USDC deposit address in Add money).
- Fund the **fee-payer with real SOL** (and monitor/alert on its balance — it sponsors every transfer +
  ATA rent).
- A **security review** before handling real funds (key custody, rate-limits, abuse).
