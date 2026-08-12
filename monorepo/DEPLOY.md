# Deploy — production (mainnet): backend → Railway, frontends → Vercel

Stage/devnet is `DEPLOY.stage.md` — read that first; prod is the same shapes with different
variables. Going to real money is a deliberate, separate step. Ship = merge `stage` → `sacred`.

**Vercel prod projects** (twins of the stage table in `DEPLOY.stage.md`, same invariants —
branch-pin Ignored Build Step `[ "$VERCEL_GIT_COMMIT_REF" = "sacred" ] && exit 1 || exit 0`,
Skip-unaffected Enabled, Node 24, and web's **Include source files outside of the Root
Directory: OFF** — see the root-cause note in `DEPLOY.stage.md`):

| project | Production Branch | Root Directory | domain |
| ------- | ----------------- | -------------- | ------ |
| web (prod) | `sacred` | **`monorepo`** | app.frenspay.xyz (TBD) |
| admin (prod) | `sacred` | `monorepo/apps/admin` | admin.frenspay.xyz |
| landing (prod) | `sacred` | `monorepo/apps/landing` | frenspay.xyz |

## Model

- One Railway project, two environments: `stage` and `production`. Pushing **`sacred`** (the prod
  branch) deploys the `production` environment — wired up only at mainnet time; until then a
  `sacred` push deploys nothing.
- Same repo-root `Dockerfile` (`node:24-slim`) and start command everywhere: `envConfig` keys off
  `NODE_ENV` (stage→`STAGE_*` prefix, prod→bare names). No per-env scripts.
- Migrations auto-apply at boot (`db:deploy` runs before `start`).

## Variables

`NODE_ENV=production` + the **bare** (unprefixed) names — the full list lives in
`apps/backend/.env.production.example`. Host-level vars stay unprefixed everywhere (`PORT` is
injected by Railway; `PUBLIC_BASE_URL=https://api.frenspay.xyz`).

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
- Web prod project sets `ACCESS_KEY` (deploy access gate) to a fresh `openssl rand -hex 32` —
  different from stage's `STAGE_ACCESS_KEY`. See the gate note in `DEPLOY.stage.md`.
