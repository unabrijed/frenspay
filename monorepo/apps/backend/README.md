# @fpay/backend

The Pay API — a **Fastify** (TypeScript) service that deploys on **Railway**, run via `tsx`
(no build step). Phase-1 endpoints from `backend-architecture.md` §2 are wired: DB-backed
reads, real Solana **devnet** USDC transfers (fee-payer sponsored), and Privy auth.

## Run locally

```bash
# from the monorepo root
yarn install
cp apps/backend/.env.example apps/backend/.env   # set NODE_ENV=stage + STAGE_DATABASE_URL etc.
yarn db:migrate                                  # apply pending migrations (src/db/migrations/)
yarn db:seed                                     # optional: 2 test users + sample activity
yarn dev:backend                                 # http://localhost:3001  (from the monorepo root)
curl localhost:3001/health                       # {"status":"ok","database":"configured"}
```

It boots without a database (`/health` shows `database:"none"`) and without Solana/Privy —
those features no-op or 401 until configured. Config is read via `src/envConfig.ts`: `NODE_ENV`
selects a prefix and all values are read under it (`stage → STAGE_*`). See `.env.example`.

### Auth in dev
- **No Privy configured:** send `x-dev-user-id: <users.id>` (printed by `db:seed`) to act as that user.
- **Privy configured:** send `Authorization: Bearer <privy access token>`; `/auth/sync` upserts the
  user + wallet on first login.

## Endpoints (Phase 1)
`GET /health` · `POST /auth/sync` · `GET /me` · `GET /balance` (on-chain USDC) ·
`GET /transactions` · `GET /users/resolve?handle=@x` · `GET|POST /requests` ·
`POST /transfer/prepare` · `POST /transfer/submit` · `POST /webhooks/helius?secret=…`.
Request/response types are shared with the app via `@fpay/shared`.

**Public (no auth)** — the landing site's f list: `POST /waitlist` (email + city + optional `ref`)
and `GET /waitlist/verify?t=…`, which stamps the confirm click and always redirects back to the
landing page rather than answering JSON. Both are unauthenticated writes, bounded only by the
IP-keyed rate limiter. See [20 · Waitlist & referral loop](../../docs/20-waitlist-referral-loop.md).

## Scripts
- `db:migrate` — apply pending migrations · `db:status` — applied/pending + drift warnings ·
  `db:new <name>` — stamp the next migration file · `db:reset` — drop + remigrate (refuses on prod) ·
  `db:seed` — dev users/activity. Schema changes are new files in `src/db/migrations/`, never edits
  to applied ones (`db:status` warns if one was edited in place).
- `devnet:setup` — provision a fee-payer + USDC mint + funded test wallets (writes `.devnet/keys.json`);
  copy the printed `STAGE_USDC_MINT` + `STAGE_FEE_PAYER_SECRET_KEY` into `.env`
- `check:waitlist` — self-check for the f-list share codes + confirm tokens (pure logic; no DB, no
  network, no framework — plain `assert`)

## Transfer flow
`/transfer/prepare` builds the USDC transfer, **fee-payer partial-signs** it, records a pending
`transfers` row, and returns the base64 tx + `transferId`. The client adds the user signature and
**broadcasts** (Privy `signAndSendTransaction` or a dev keypair), then calls `/transfer/submit` with
`{transferId, signature}`. A background poller (and the Helius webhook) flip the row to `confirmed`.

## Deploy on Railway

The step-by-step runbook — every dashboard setting, variable, domain step, and test — is
[`DEPLOY.stage.md`](../../DEPLOY.stage.md) (prod: [`DEPLOY.md`](../../DEPLOY.md)). The shape, so
this README doesn't lie by omission:

- **Railway does not build — it pulls.** The service's source is a Docker image, so no push can
  trigger a build there. Pushing **`stage`** runs `.github/workflows/backend-image.yml`, which
  builds the repo-root **`Dockerfile`** (`node:24-slim`) on GitHub Actions, pushes it to
  `ghcr.io/unabrijed/fpay-backend:<sha>`, and tells Railway to pull that SHA. Path isolation is
  `scripts/vercel-ignore.mjs backend` — the same gate the Vercel projects use.
- No dashboard start command: the container CMD runs `db:deploy && start`, so migrations always
  precede the server.
- **The backend goes live before the frontends.** Keep API changes backward-compatible for one
  deploy cycle — a new frontend against an old backend is the pairing that breaks.
- DB is **Supabase Postgres** via `STAGE_DATABASE_URL` — always the **session** pooler (`:5432`),
  never the transaction pooler (it breaks the advisory locks).
- Variables: `NODE_ENV=stage` + the `STAGE_*` list (KYC config is mandatory — boot throws without
  it), plus unprefixed host vars: `PORT` (Railway injects — never set) and `PUBLIC_BASE_URL`.
  Full checklist in the runbook; secret values come from the working `apps/backend/.env`.
- Healthcheck path `/health`; the Helius webhook self-registers on boot against `PUBLIC_BASE_URL`.

> Cost: Railway's free trial / low-cost hobby tier is fine for Phase 1. No other paid services required.
