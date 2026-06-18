# @pay/backend

The Pay API — a **Fastify** (TypeScript) service that deploys on **Railway**, run via `tsx`
(no build step). Phase-1 endpoints from `backend-architecture.md` §2 are wired: DB-backed
reads, real Solana **devnet** USDC transfers (fee-payer sponsored), and Privy auth.

## Run locally

```bash
# from the monorepo root
yarn install
cp apps/backend/.env.example apps/backend/.env   # then fill DATABASE_URL etc.
yarn workspace @pay/backend db:init              # apply src/db/schema.sql
yarn workspace @pay/backend db:seed              # optional: 2 test users + sample activity
yarn workspace @pay/backend dev                  # http://localhost:3000
curl localhost:3000/health                       # {"status":"ok","database":"configured"}
```

It boots without a database (`/health` shows `database:"none"`) and without Solana/Privy —
those features no-op or 401 until configured. See `.env.example` for every variable.

### Auth in dev
- **No Privy configured:** send `x-dev-user-id: <users.id>` (printed by `db:seed`) to act as that user.
- **Privy configured:** send `Authorization: Bearer <privy access token>`; `/auth/sync` upserts the
  user + wallet on first login.

## Endpoints (Phase 1)
`GET /health` · `POST /auth/sync` · `GET /me` · `GET /balance` (on-chain USDC) ·
`GET /transactions` · `GET /users/resolve?handle=@x` · `GET|POST /requests` ·
`POST /transfer/prepare` · `POST /transfer/submit` · `POST /webhooks/helius?secret=…`.
Request/response types are shared with the app via `@pay/shared`.

## Scripts
- `db:init` — apply the schema · `db:seed` — dev users/activity
- `devnet:setup` — provision a fee-payer + USDC mint + funded test wallets (writes `.devnet/keys.json`);
  copy the printed `USDC_MINT` + `FEE_PAYER_SECRET_KEY` into `.env`

## Transfer flow
`/transfer/prepare` builds the USDC transfer, **fee-payer partial-signs** it, records a pending
`transfers` row, and returns the base64 tx + `transferId`. The client adds the user signature and
**broadcasts** (Privy `signAndSendTransaction` or a dev keypair), then calls `/transfer/submit` with
`{transferId, signature}`. A background poller (and the Helius webhook) flip the row to `confirmed`.

## Deploy on Railway (Yarn monorepo)
1. Create a Railway project + a **Postgres** plugin (sets `DATABASE_URL`).
2. Add a **service** from the repo. Settings:
   - **Root Directory**: `monorepo` · **Start Command**: `yarn workspace @pay/backend start`
     (also in `railway.json`) · **Healthcheck Path**: `/health`.
3. Nixpacks installs the workspace; Node is pinned to 22 via `monorepo/.nvmrc`.
4. Set service **Variables**: `SOLANA_RPC_URL`, `HELIUS_API_KEY`, `FEE_PAYER_SECRET_KEY`, `USDC_MINT`,
   `PRIVY_APP_ID/SECRET/VERIFICATION_KEY`, `HELIUS_WEBHOOK_SECRET`, `CORS_ORIGIN`.
5. Run the schema once: `yarn workspace @pay/backend db:init` against the Railway `DATABASE_URL`.
6. Point the Helius webhook at `https://<service>/webhooks/helius?secret=<HELIUS_WEBHOOK_SECRET>`.

> Cost: Railway's free trial / low-cost hobby tier is fine for Phase 1. No other paid services required.
