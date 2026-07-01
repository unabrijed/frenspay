# Deploy — wallet-to-wallet USDC (Solana devnet)

Goal: host the backend + web so two people on two devices can sign up (Privy) and send USDC to each
other. **Devnet** (real on-chain, test USDC via the faucet). No merchant, no cross-chain. Mainnet is a
separate later step (bottom of this doc).

Two services:
- **Backend** — Fastify on **Railway** (`apps/backend`, `railway.json` already configured).
- **Web** — Next.js 15 on **Vercel** (`apps/web`, `vercel.json` added).
- **DB** — Railway Postgres (already attached for the local/stage `DATABASE_URL`).

Env convention: backend runs with `NODE_ENV=stage` → reads `STAGE_*` keys (see `apps/backend/.env.example`).
A web production build reads unprefixed `NEXT_PUBLIC_*` (see `apps/web/.env.example`). `PORT` and
`PUBLIC_BASE_URL` are host-level (unprefixed).

---

## 1. Backend → Railway

1. New Railway **service** from this repo. Root directory: `monorepo` (the yarn workspace root). Builder
   is **Nixpacks** (no Dockerfile). Start command + healthcheck come from `apps/backend/railway.json`
   (`yarn workspace @fpay/backend start`, `/health`). Node is pinned to 22 via `.nvmrc`.
2. Attach (or reuse) a **Postgres** plugin and set `STAGE_DATABASE_URL` to its connection string (SSL on;
   leave `STAGE_PGSSL` unset).
3. Set service **Variables**:
   ```
   NODE_ENV=stage
   STAGE_DATABASE_URL=<from the Postgres plugin>
   STAGE_SOLANA_RPC_URL=https://api.devnet.solana.com   # or a Helius devnet URL
   STAGE_FEE_PAYER_SECRET_KEY=[ ... ]                    # JSON byte array from `yarn devnet:setup`
   STAGE_USDC_MINT=vsL2tTkok8U7nMZMpFS1Z5PVJpVmk4uuuvoQQUBvfhf
   STAGE_PRIVY_APP_ID=<privy app id>
   STAGE_PRIVY_APP_SECRET=<privy app secret>            # backend-only, never in the web build
   PUBLIC_BASE_URL=https://<this-railway-service>.up.railway.app
   STAGE_CORS_ORIGIN=https://<your-web-domain>          # fill in after step 2 (Vercel URL)
   ```
   The fee-payer secret, USDC mint, and a funded fee-payer wallet already exist locally from
   `yarn devnet:setup` (`apps/backend/.devnet/keys.json`) — copy those values up. The fee-payer needs a
   little devnet SOL (it already holds ~10).
4. Deploy. Initialize the schema once (idempotent) against the Railway DB:
   ```
   yarn workspace @fpay/backend db:init      # applies apps/backend/src/db/schema.sql
   ```
   (Run locally with `STAGE_DATABASE_URL` pointed at the Railway DB, or via Railway's shell.)
5. Verify: `curl https://<backend>/health` → `{"status":"ok","database":"configured"}`.

## 2. Web → Vercel

1. New Vercel project from this repo. **Root Directory: `apps/web`** (Vercel auto-detects the yarn
   workspace and installs at the repo root). `apps/web/vercel.json` pins framework + the workspace build.
2. Production **Environment Variables** (read at build time, inlined by Next):
   ```
   NEXT_PUBLIC_API_URL=https://<backend>.up.railway.app
   NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
   NEXT_PUBLIC_PRIVY_APP_ID=<same privy app id as backend>
   ```
   (`NODE_ENV=production` is set by Vercel automatically → the app reads the unprefixed keys above.)
3. Deploy → note the URL (e.g. `https://pay.vercel.app`).
4. Go back to Railway and set `STAGE_CORS_ORIGIN` = that web origin; redeploy the backend.

## 3. Privy dashboard

In the Privy app (`Settings → Allowed origins`): add the deployed web origin (`https://pay.vercel.app`)
alongside `http://localhost:3000`. Ensure **Email login** + **Solana embedded wallets** are enabled (and
**Passkey** if you want the in-app "add a second device" recovery to work).

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

Going to real money is a deliberate, separate step:
- Use **Circle's USDC mint** (`EPjFWdd5...`) and a **mainnet RPC** (Helius mainnet).
- **Disable the faucet** — `/devnet/faucet` is already gated to `config.isDevelopment`; ensure prod isn't
  flagged development. Funding becomes **deposit-only** (the existing USDC deposit address in Add money).
- Fund the **fee-payer with real SOL** (and monitor/alert on its balance — it sponsors every transfer +
  ATA rent).
- A **security review** before handling real funds (key custody, rate-limits, abuse).
