# @fpay/backend

The Pay API — a **Fastify** (TypeScript) service that deploys on **Railway**, run via `tsx`
(no build step). Phase-1 endpoints from `backend-architecture.md` §2 are wired: DB-backed
reads, real Solana **devnet** USDC transfers (fee-payer sponsored), and Privy auth.

## Run locally

```bash
# from the monorepo root
yarn install
cp apps/backend/.env.example apps/backend/.env   # set NODE_ENV=stage + STAGE_DATABASE_URL etc.
yarn workspace @fpay/backend db:init              # apply src/db/schema.sql
yarn workspace @fpay/backend db:seed              # optional: 2 test users + sample activity
yarn dev:backend                                 # http://localhost:3001  (from the monorepo root)
curl localhost:3001/health                       # {"status":"ok","database":"configured"}
```

It boots without a database (`/health` shows `database:"none"`) and without Solana/Privy —
those features no-op or 401 until configured. Config is read via `src/config.ts`: `NODE_ENV`
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
- `db:init` — apply the schema · `db:seed` — dev users/activity
- `devnet:setup` — provision a fee-payer + USDC mint + funded test wallets (writes `.devnet/keys.json`);
  copy the printed `STAGE_USDC_MINT` + `STAGE_FEE_PAYER_SECRET_KEY` into `.env`
- `check:waitlist` — self-check for the f-list share codes + confirm tokens (pure logic; no DB, no
  network, no framework — plain `assert`)

## Transfer flow
`/transfer/prepare` builds the USDC transfer, **fee-payer partial-signs** it, records a pending
`transfers` row, and returns the base64 tx + `transferId`. The client adds the user signature and
**broadcasts** (Privy `signAndSendTransaction` or a dev keypair), then calls `/transfer/submit` with
`{transferId, signature}`. A background poller (and the Helius webhook) flip the row to `confirmed`.

## Deploy on Railway (Yarn monorepo)
1. Create a Railway project + a **Postgres** plugin (sets `DATABASE_URL`).
2. Add a **service** from the repo. Settings:
   - **Root Directory**: `monorepo` · **Start Command**: `yarn workspace @fpay/backend start`
     (also in `railway.json`) · **Healthcheck Path**: `/health`.
3. Nixpacks installs the workspace; Node is pinned to 22 via `monorepo/.nvmrc`.
4. Set service **Variables**: `NODE_ENV=stage`, then the stage-prefixed values —
   `STAGE_SOLANA_RPC_URL`, `STAGE_HELIUS_API_KEY`, `STAGE_FEE_PAYER_SECRET_KEY`, `STAGE_USDC_MINT`,
   `STAGE_PRIVY_APP_ID`/`STAGE_PRIVY_APP_SECRET`/`STAGE_PRIVY_VERIFICATION_KEY`,
   `STAGE_HELIUS_WEBHOOK_SECRET`, `STAGE_CORS_ORIGIN`. (`PORT` is injected unprefixed by Railway.)
   For the f list also set `STAGE_RESEND_API_KEY`, `STAGE_EMAIL_FROM`, `STAGE_WAITLIST_SECRET` and
   `STAGE_LANDING_URL` — all four, or none: unset means no share codes and no mail, and `/waitlist`
   behaves exactly as it did before the referral loop existed.
5. Run the schema once: `yarn workspace @fpay/backend db:init` against the Railway `STAGE_DATABASE_URL`.
6. Point the Helius webhook at `https://<service>/webhooks/helius?secret=<HELIUS_WEBHOOK_SECRET>`.

> Cost: Railway's free trial / low-cost hobby tier is fine for Phase 1. No other paid services required.
