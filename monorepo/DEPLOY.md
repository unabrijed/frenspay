# Deploy — production (mainnet): backend → Railway, frontends → Vercel

Stage/devnet is `DEPLOY.stage.md` — read that first; prod is the same shapes with different
variables. Going to real money is a deliberate, separate step. Ship = merge `stage` → `sacred`.

**Vercel prod projects** — twins of the stage projects; run the same "Project setup — every step,
per project" list in `DEPLOY.stage.md` with these substitutions:

| project | Production Branch | Root Directory | domain |
| ------- | ----------------- | -------------- | ------ |
| web (prod) | `sacred` | **`monorepo`** | app.frenspay.xyz (TBD) |
| admin (prod) | `sacred` | `monorepo/apps/admin` | admin.frenspay.xyz |
| landing (prod) | `sacred` | `monorepo/apps/landing` | frenspay.xyz |

- **Branch pin** `sacred`: option A (Preview Deployments off), or option B
  `[ "$VERCEL_GIT_COMMIT_REF" = "sacred" ] && exit 1 || exit 0`.
- Same invariants: Skip-unaffected Enabled, Node 24, and web's **Include source files outside of
  the Root Directory: OFF** (root-cause note in `DEPLOY.stage.md` — web ships middleware, it can
  never become a static export).
- **Variables** use the **bare** names (no `STAGE_` segment): `NEXT_PUBLIC_APP_ENV` is NOT set
  (production is the build default), plus `NEXT_PUBLIC_API_URL=https://api.frenspay.xyz`,
  `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID`, `NEXT_PUBLIC_LANDING_URL` (web +
  admin as applicable, landing gets `NEXT_PUBLIC_API_URL`), and web's **`ACCESS_KEY`** — the
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
  flagged development. Funding becomes **deposit-only** (the existing USDC deposit address in Add
  money).
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
- Set `ADMIN_EMAILS` (bare name in prod) before the console has a second operator — see the
  root-admins section in `DEPLOY.stage.md` for why it is the lockout recovery path.
- Set landing's `NEXT_PUBLIC_APP_URL` to the prod web origin, or accepted invite codes redirect to
  `localhost:3000`.
