# Deploy — production (mainnet): backend → Railway, frontends → Vercel

Stage (mainnet-lite) is `DEPLOY.stage.md` — read that first; prod is the same shapes with
different variables. There is no devnet deployment anywhere; devnet exists only in local dev. Going to real money is a deliberate, separate step. Ship = merge `stage` → `sacred`.

**Vercel prod projects** — twins of the stage projects; run the same "Project setup — every step,
per project" list in `DEPLOY.stage.md` with these substitutions:

| project | Production Branch | Root Directory | domain |
| ------- | ----------------- | -------------- | ------ |
| web (prod) | `sacred` | **`monorepo`** | app.frenspay.xyz (TBD) |
| landing (prod) | `sacred` | `monorepo/apps/landing` | frenspay.xyz |

**Admin has no prod twin — on purpose.** There is one admin project (`DEPLOY.stage.md` §Frontends)
and the operator switches it between backends in the sidebar. What prod needs from you is not a
second project but two variables elsewhere: `NEXT_PUBLIC_API_URL=https://api.frenspay.xyz` on the
one admin project (that alone is what makes prod selectable), and the admin origin added to this
environment's bare `CORS_ORIGIN`. Details and the reasoning: `apps/admin/README.md` §Deploy.

- **Branch pin**: nothing to set. The repo's `ignoreCommand` gate builds only when
  `VERCEL_ENV=production`, which a project sees only on its own Production Branch — so setting that
  to `sacred` here IS the pin, from the same `vercel.json` the stage twin uses (`DEPLOY.stage.md`
  §Path gate). Clear any hand-written Ignored Build Step: `vercel.json` overrides it.
- Same invariants: Skip-unaffected Enabled, Node 24, and web's **Include source files outside of
  the Root Directory: OFF** (root-cause note in `DEPLOY.stage.md` — web ships middleware, it can
  never become a static export).
- **Variables** use the **bare** names (no `STAGE_` segment): `NEXT_PUBLIC_APP_ENV` is NOT set
  (production is the build default), plus `NEXT_PUBLIC_API_URL=https://api.frenspay.xyz`,
  `NEXT_PUBLIC_SOLANA_RPC_URL=<mainnet RPC>` (drives web's `IS_MAINNET`; a deployed build fails
  CLOSED to mainnet if unset — envConfig.ts — so this var only picks WHICH mainnet RPC),
  `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID`, `NEXT_PUBLIC_LANDING_URL` (web only —
  landing gets `NEXT_PUBLIC_API_URL`; admin reads neither, see above), and web's **`ACCESS_KEY`** — the
  deploy access gate, a fresh `openssl rand -hex 32`, **different from stage's key**. The prod
  project is gated from its first deploy, not just at mainnet; unsetting `ACCESS_KEY` later is the
  "open to the public" launch switch.
- **Domains**: attach per the table (CNAME from Vercel), API domain `api.frenspay.xyz` on the
  Railway prod service (same steps as stage's step 6), then set the backend's bare `CORS_ORIGIN`
  to the full prod origin list.
- **Test**: same per-app checks as `DEPLOY.stage.md` step 7, against the prod domains — gate form
  on web, `curl https://api.frenspay.xyz/health`, no localhost/stage origins in the Network tab.

## Model

- One Railway project, two environments: `stage` and `production`. Pushing **`sacred`** (the prod
  branch) deploys the `production` environment — wired up only at mainnet time; until then a
  `sacred` push deploys nothing.
- Same repo-root `Dockerfile` (`node:24-slim`) and start command everywhere: `envConfig` keys off
  `NODE_ENV` (stage→`STAGE_*` prefix, prod→bare names). No per-env scripts.
- **Railway builds nothing** — the service pulls a prebuilt image that GitHub Actions pushes to
  GHCR (`DEPLOY.stage.md` §Build model). Wiring prod means: a `sacred` branch trigger and a
  `:prod`/`:<short-sha>` tag in `.github/workflows/backend-image.yml`, a **production**-scoped
  `RAILWAY_TOKEN`, and the same image source + `/health` healthcheck + ON_FAILURE/3 restart policy
  on the production service, pinned to `:prod` the way stage is pinned to `:stage`. The image is
  env-agnostic; only variables differ.
- **The GHCR package is public and the repo is not.** Railway's Hobby plan cannot pull a private
  image (registry credentials are Pro-only), so the image is public and the Dockerfile's runner
  stage exists to make that safe: minified bundles, no source. If prod ever justifies Railway Pro,
  make the package private and add registry credentials per environment — but until then, anything
  added to the runner stage is published. `oms` runs under the identical constraint.
- **The backend goes live before the frontends**, so keep API changes backward-compatible for one
  deploy cycle. This matters more at prod than at stage: real money is moving through the window.
- Migrations auto-apply at boot (`db:deploy` runs before `start`).

## Variables

`NODE_ENV=production` + the **bare** (unprefixed) names — the full backend list lives in
`apps/backend/.env.production.example`. Host-level vars stay unprefixed everywhere (`PORT` is
injected by Railway — never set it; `PUBLIC_BASE_URL=https://api.frenspay.xyz`). Frontend
variables live per Vercel project (see the block above); web's `ACCESS_KEY` is documented in
`apps/web/.env.example`.

## Mainnet checklist

- Use **Circle's mainnet USDC mint** (`EPjFWdd5...`) and a **mainnet RPC** (Helius mainnet).
- **Disable the faucet** — `/devnet/faucet` is gated to `config.isDevelopment`; ensure prod isn't
  flagged development. The web UI also fails closed: `IS_MAINNET` defaults true in prod/stage
  builds, hiding the faucet block. Funding becomes **deposit-only** (the existing USDC deposit
  address in Add money).
- Fund the **fee-payer with real SOL** (and monitor/alert on its balance — it sponsors every
  transfer + ATA rent).
- `CORS_ORIGIN` must list EVERY prod browser origin (see the CORS section in `DEPLOY.stage.md` —
  same rule, bare variable name).
- A **security review** before handling real funds (key custody, rate-limits, abuse).
- **Decide the door — there are now two, and they don't stack well.** `ACCESS_KEY` is one shared
  secret checked in `apps/web/src/middleware.ts` (device cookie, no identity); invite codes are
  per-person and enforced at `/auth/sync`. Since the landing gate hands a valid-code holder to the
  web app, they hit the access-key wall *anyway* and still can't get in unless you also send them
  the shared key — two secrets per invited user, which defeats the invite.
  - Recommended at launch: **unset `ACCESS_KEY`** and let the invite code be the only door. That is
    what it is for, and it is the same launch switch described in the Vercel block above.
  - Keep both only while the deploy itself is meant to be private (a build nobody outside the team
    should reach), and accept that invites are inert until you unset it.
- **Bootstrap the first admin, in this order.** Not hardening for later — the console is unreachable
  until both steps are done, and doing them backwards fails in a way that reads like a bug (a 401
  with no explanation, or your own signup asking you for an invite code).
  1. Set the **bare** `ADMIN_EMAILS` on the Railway production service (prod takes no prefix, so
     `STAGE_ADMIN_EMAILS` here does nothing). Wait for the redeploy.
  2. Sign into **web** once with that address and pick a handle. The console never calls
     `/auth/sync` — only web does — so this is the only way its operator's row gets created, and it
     is what writes the Privy-verified email that `ADMIN_EMAILS` matches against.

  The order is load-bearing: the invite gate exempts root admins by checking `ADMIN_EMAILS` **during
  that sync**, so if the variable isn't live yet, your own signup is treated as an ordinary one and
  is refused with `invite_required` on any non-empty directory. Note web sits behind `ACCESS_KEY`
  until you unset it, so you need that key to do step 2 at all. Why this exists at all:
  the root-admins section in `DEPLOY.stage.md`.
- Landing needs only `NEXT_PUBLIC_API_URL`. `NEXT_PUBLIC_APP_URL` is no longer read — a code is spent
  joining the f list, not handed off to the app — so remove it if it is already set.
