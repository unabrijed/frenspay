# Deploy — production (mainnet): backend → Railway, frontends → Vercel

Stage (mainnet-lite) is `DEPLOY.stage.md` — read that first; prod is the same shapes with
different variables. There is no devnet deployment anywhere; devnet exists only in local dev. Going to real money is a deliberate, separate step. Ship = merge `stage` → `sacred`.

**Vercel projects on `sacred`** (the full map is the table in `DEPLOY.stage.md` §Frontends). These
are what a `sacred` push builds, set up with the same "Project setup — every step, per project"
list and these values:

| project (Vercel name) | app | Production Branch | Root Directory | domain |
| --- | --- | --- | --- | --- |
| `frenspay-prod` | web | `sacred` | **`monorepo`** | app.frenspay.xyz (TBD) |
| `merchants` | lp, the only lp project | `sacred` | `monorepo/apps/lp` | provider.frenspay.xyz, gated by its own `ACCESS_KEY` |
| `frenspay` | landing, the only landing project | `sacred` | `monorepo/apps/landing` | frenspay.xyz |
| `frenspay-admin` | admin, the only admin project | `sacred` | `monorepo/apps/admin` | admin.frenspay.xyz |

Only web has a stage twin (`frenspay-stage`). lp, landing and admin deploy from `sacred` alone: they
change when `stage` is merged, never on a stage push.

**Admin has no twin — on purpose.** There is one admin project (`DEPLOY.stage.md` §Frontends)
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
  `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID` (the SAME values stage uses — the one
  Privy app has no tiered twins, on any app or the backend), `NEXT_PUBLIC_LANDING_URL` (web only —
  landing gets `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_URL`; admin reads neither).
  Only the LP console sets **`ACCESS_KEY`**, a fresh `openssl rand -hex 32` distinct from its stage
  key. Customer web ignores old `ACCESS_KEY` / `STAGE_ACCESS_KEY` variables; remove them after deploy.
- **Domains**: attach per the table (CNAME from Vercel), API domain `api.frenspay.xyz` on the
  Railway prod service (same steps as stage's step 6), then set the backend's bare `CORS_ORIGIN`
  to the full prod origin list.
- **Test**: same per-app checks as `DEPLOY.stage.md` step 7, against the prod domains — gate form
  on web, `curl https://api.frenspay.xyz/health`, no localhost/stage origins in the Network tab.

## Model

- One Railway project, two environments: `stage` and `production`. Pushing **`sacred`** (the prod
  branch) deploys the `production` environment, gated by the same `scripts/vercel-ignore.mjs backend`
  scope as stage.
- Same repo-root `Dockerfile` (`node:24-slim`) and start command everywhere: `envConfig` keys off
  `NODE_ENV` (stage→`STAGE_*` prefix, prod→bare names). No per-env scripts.
- **CI and the service are both wired** (the `production` service answers `api.frenspay.xyz/health`).
  `.github/workflows/backend-image.yml` triggers on both `stage` and `sacred`, selecting the token,
  service and Railway environment from the branch. So **a `sacred` push deploys the backend
  automatically — and the container runs migrations against the production database before the
  server starts** (`Dockerfile` CMD; a failed migration is a crash-looping deploy in Railway, not a
  red Actions run). Verify everything below before the first push that carries a migration; a missing
  item fails loudly (deliberately: the prod frontends ship from the same push, and a quietly-skipped
  backend would hide a version split behind a green run).

  1. **A separate production database — not stage's.** `apps/backend/src/db/tier.ts` stamps every
     database with the tier that owns it and refuses to serve another: *"refusing to run against the
     wrong tier's database"*, fatal at boot. Create a new Supabase project, use the **session**
     pooler (`:5432`, never the transaction pooler — advisory locks), and set it as the bare
     `DATABASE_URL`.
  2. **Railway service.** `production` environment → New → **Empty Service**. Healthcheck `/health`,
     restart ON_FAILURE max 3. Never "Deploy from GitHub repo" — and check Settings → Source even on
     a service you did not create that way; a repo connection means two deployments per push and a
     bypassed path gate. Name it whatever you like; the stage twin is `frenspay-stage`.
  3. **CI credentials.** GitHub → Settings → Secrets and variables → Actions: secret
     **`RAILWAY_PROD_TOKEN`** (a Railway **project** token scoped to **production**; an *account*
     token is read from `RAILWAY_API_TOKEN`, carries no project, and 404s) and variable
     **`RAILWAY_PROD_SERVICE`** = that service's name, **read back from `railway status`** rather
     than typed. A mismatch surfaces as `Failed to upload code with status code 404 Not Found`,
     which reads like a broken token and is not.
  4. **Variables, bare names, before the first deploy.** Three asserts run before the server accepts
     traffic and every one of them is fatal:
     - `assertKycConfig` (`services/kyc/index.ts`) — prod runs **persona**. It now throws for exactly
       one config: a `persona_production_…` key is what belongs here, and a `persona_sandbox_…` key is
       refused outright. **`KYC_PROVIDER=persona` must be set explicitly** — there is no default on a
       deployed tier, so an unset variable means identity verification is off. **Leaving it, or
       `PERSONA_API_KEY` / `PERSONA_TEMPLATE_ID`, blank is legal** — it means identity verification is
       off (`config.personaLive`), `/kyc/verify` 503s, the payer app hides its verification surface
       instead of explaining itself, and partner onboarding falls back to a human reading the business
       form (docs/14, an accepted risk). Placeholder-looking values count as blank.
       Stage runs persona too — it is mainnet, so `sim` there would instant-promote to tier 2 with no
       documents against real money. `sim` is a local-only convenience: on **either** deployed tier it
       means no real identity verification on real funds.
     - `assertPayoutConfig` (`services/payout/provider.ts`)
     - `assertDatabaseTier` — item 1.

  The image is environment-agnostic — `envConfig` keys off `NODE_ENV` — so nothing in the build
  changes, only variables.
- **Nothing is published to a registry**, at either tier: CI uploads the checkout and Railway builds
  it. No image exists outside Railway, so the private repo stays private. The faster
  build-here-and-pull design needs a **public** image (Railway gates private-registry pulls behind
  **Pro**), and a public image is a readable codebase. Full reasoning: `DEPLOY.stage.md` §How a
  deploy happens.
- **The frontends can go live before the backend**, because a Railway build takes 3–5 minutes and
  Vercel takes 2–3. Keep API changes backward-compatible for one deploy cycle — add the field or
  route first, switch the frontend later, remove the old one after that. This matters more at prod
  than at stage: real money is moving through the window.
- **Rollback**: Railway → the prod service → Deployments → last good one → Redeploy (no image tags
  exist to re-pin). Migrations do not roll back — write them additively. Frontends: Vercel →
  Deployments → Promote a previous one.
- Migrations auto-apply at boot (`db:deploy` runs before `start`).

## Variables

`NODE_ENV=production` + the **bare** (unprefixed) names — the full backend list lives in
`apps/backend/.env.production.example`. Host-level vars stay unprefixed everywhere (`PORT` is
injected by Railway — never set it; `PUBLIC_BASE_URL=https://api.frenspay.xyz`). Frontend
variables live per Vercel project (see the block above); the LP console's `ACCESS_KEY` is documented
in `apps/lp/.env.example`. Customer web uses email OTP and invited f-list membership.

## Keys

Two secrets (a third is optional) and two public addresses make payments work (`docs/16`). All are
**bare** names on prod (no prefix), pasted as Railway variables on the production backend service.
Payments (`/orders/quote`, `POST /orders`) answer `503 payments_unavailable` until the escrow key and
the earnings address are both usable — a missing or malformed one is a boot **warning**, never a
crash — so the order below is safe to do across several sittings.

| Variable | What it is | Shape | Holds / needs |
|---|---|---|---|
| `ESCROW_SECRET_KEY` | the escrow **pool**'s owner: every payer deposit sits in its USDC token account until the order is released or refunded; it signs the transfers out | JSON byte array (`[12,34,…]`, 64 numbers) — base58 is rejected | **no SOL** with a fee-payer; **~0.05 SOL** without one (it then pays its own gas) |
| `FEE_PAYER_SECRET_KEY` | **optional** — who pays gas. Set: it co-signs every user transaction and pays every fee. Unset: **sponsored mode** — Privy pays user transactions (dashboard → Gas Sponsorship → Solana ON; web only), the escrow key pays its own | same | **~0.1 SOL**, monitored (when set) |
| `PLATFORM_FEE_DESTINATION` | where the platform's cut lands on each release | base58 **public** key | a cold wallet; nothing signs from it |
| `STAKE_TREASURY_ADDRESS` | where partner bond is deposited | base58 **public** key | a cold wallet; withdrawals are sent by hand |
| `USDC_MINT` | Circle's mainnet USDC — the default; set only to override | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | — |

**Generating the prod escrow key — your machine, never the server, never CI:**

1. `solana-keygen new --no-bip39-passphrase -o prod-escrow.json` — a fresh keypair; not the
   fee-payer, not the stake treasury, not any wallet that has ever been on a laptop shared with a
   browser extension.
2. `solana address -k prod-escrow.json` — the public address. Write it down; it is what Solscan
   shows every pilot deposit landing in, and what `check:pool` reads.
3. `cat prod-escrow.json` → the `[ … ]` array. Railway → production backend service → **Variables**
   → `ESCROW_SECRET_KEY` = paste the whole array, brackets included, no quotes. Railway stores it
   encrypted; it never appears in a build log (`envConfig` only ever prints the variable's *name*).
4. **Back the file up** — an encrypted volume or a password manager's secure note, then delete the
   plaintext. A lost escrow key loses whatever the pool holds at that moment: there is no self-refund
   under this design (`docs/16`). The pool is small because settlements take minutes, but it is not
   zero while an order is open.
5. **Choose who pays gas** (`docs/16 §Who pays gas`). Either set `FEE_PAYER_SECRET_KEY`
   (`prod-feepayer.json`, same format) and fund **that** address with ~0.1 SOL — then the escrow key
   needs no SOL — **or** leave it unset for sponsored mode: turn on **Gas Sponsorship → Solana** in the
   Privy dashboard (web only; the phone app cannot pay in this mode) and send the **escrow** address
   ~0.05 SOL, because it then pays for release, refund and every new token account itself. The boot
   log names the mode every start.
6. Set `PLATFORM_FEE_DESTINATION` and `STAKE_TREASURY_ADDRESS` to two **cold** public keys (a
   hardware wallet's receive addresses are fine). Never a secret here — the backend only ever
   sends *to* them.
7. Redeploy (Railway restarts on a variable change). The boot log should carry **no**
   `[config] WARNING … ESCROW_SECRET_KEY …` line. Confirm with a `$1` order: fund it, let the
   10-minute claim window lapse, watch the refund come back from the pool
   (`yarn workspace @fpay/backend check:pool` reconciles to zero). Order zero is a refund on purpose.

**Rotating the escrow key:** generate a new one, wait until `check:pool` shows an empty pool (no open
orders), swap the variable, redeploy. In-flight orders would otherwise be paid out of a pool the new
key does not own.

## Mainnet checklist

- **Circle's mainnet USDC mint** is the default; use a **mainnet RPC** (Helius mainnet).
- There is no faucet and no testnet anywhere (`docs/15`); funding is **deposit-only** (the USDC
  deposit address in Add money). Nothing to disable.
- Fund the **fee-payer with real SOL** (and monitor/alert on its balance — it sponsors every
  transfer + ATA rent). The escrow key needs none — §Keys above.
- `CORS_ORIGIN` must list EVERY prod browser origin (see the CORS section in `DEPLOY.stage.md` —
  same rule, bare variable name).
- A **security review** before handling real funds (key custody, rate-limits, abuse).
- **Customer access:** verified email plus an f-list entry backed by a redeemed invite. This applies
  to existing customer accounts too. Nonmembers redeem an invite inside the app; no landing detour.
  Shared profile/identity endpoints preserve established admin and partner access, while customer
  payment and campaign routes enforce membership server-side.
- **Bootstrap the first admin, in this order.** Not hardening for later — the console is unreachable
  until both steps are done, and doing them backwards fails in a way that reads like a bug (a 401
  with no explanation, or your own signup asking you for an invite code).
  1. Set the **bare** `ADMIN_EMAILS` on the Railway production service (prod takes no prefix, so
     `STAGE_ADMIN_EMAILS` here does nothing). Wait for the redeploy.
  2. Create the operator's handle through the **LP console** (using its access key). Its
     `/auth/sync` setup supports root-admin bootstrap without f-list membership. Alternatively,
     an invited member can use the customer web flow. The admin console itself never creates users.
  Customer web always requires invited membership, including when an operator visits it.
- Landing uses `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_URL=https://app.frenspay.xyz`.
  Both its header's Launch app link and signup handoff use that app URL.

### Email and invite rollout

Deploy the backend first, then customer web and landing. No new schema migration is needed:
existing `waitlist.invite_code`, redemption records and code ownership are reused. Existing list
rows without a redeemed invite must redeem one; no automatic grandfathering is performed.

The public signup response retains `invites: []` for compatibility. Private code retrieval uses
`GET /flist/me`; `POST /flist/join` accepts a code and derives the email from Privy. New signup uses
OTP verification instead of a separate confirmation email; existing confirmation links still work.
The three-code allowance is reused when an f-list member creates an app account.

Validate signup → OTP → app, direct-app inline joining, returning login, and Invite a fren on
staging before promoting the frontend builds. Check both existing web modes and verify partner
and admin login. Old access-key cookies have no effect on customer web.

Isolated SQL/HTTP check (Yarn-installed PGlite; no application DB connection):
`FLIST_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js yarn workspace @fpay/backend check:flist:access`.
PGlite serializes connections; verify competing redemptions against isolated PostgreSQL when
checking production lock scheduling.


## Solana merchant-payment pilot

The customer entry is the main product. Legacy Monad practice signup, quotes and spends are retired;
`/prelaunch` redirects to `/legacy-wallet`. Existing wallet access, funds and receipt recovery remain available.
Do not reset the database or erase device storage. Cache version 3 refreshes only cached identity, balance,
activity and rates; authentication, wallets, bill data and pending transaction/deposit/withdrawal keys survive.

Apply additive migrations **0032 and 0033** through the normal database deployment workflow before serving
this release. No existing financial records are deleted. Ordinary LP-backed rails remain outside the new
merchant route; normal Scan rejects UPI/QRIS/PayNow. Existing order recovery continues.

Backend variables (use `STAGE_` or `LOCAL_` prefixes for those tiers):

| Variable | Initial setting / purpose |
|---|---|
| `MERCHANT_PAY_ENABLED` | `false`; enable after provider eligibility and smoke testing |
| `CARD_FUNDING_ENABLED` | `false`; enable after dashboard funding activation and eligibility checks |
| `WCP_PROJECT_ID` | Wallet project ID from the WalletConnect dashboard |
| `PAYMENT_PILOT_USERS` | Explicit comma-separated customer UUIDs; empty denies everyone |
| `PAYMENT_CHAIN` | `solana`; unknown/unimplemented chains fail closed |
| `PAYMENT_POLICY_VERSION` | `solana-usdc-v1`; change when changing policy |
| `PAYMENT_COLLECT_HOSTS` | Exact verified HTTPS information-form hosts; empty refuses forms |

The backend uses the standalone Node SDK with the project ID, not the separately approved Gateway API.
The client only signs the reviewed Solana transaction. The provider broadcasts; do not use the existing
sign-and-send method or rewrite the provider's transaction for sponsorship. V1 accepts one direct native-USDC
SPL transfer transaction with an external fee payer. Mixed-chain routes, arbitrary programs and user-paid SOL
fees fail closed. Adding a network requires a tested adapter and a balance migration plan, not just a config edit.
Changing policy does not rewrite pending transactions. Keep the old provider credentials/RPC available for recovery.

Enable card funding in the existing Privy dashboard. The installed web SDK uses `useFundWallet` with explicit
USDC and Solana mainnet options. Card entry and any provider-supported saved-card flow are hosted. The app never
stores card details or credits a callback balance. Check actual payer-country/card eligibility; broader fiat
currency support can require Meld KYB. Frenspay does not yet have a registered entity, and wallet integration
access alone is not proof of production eligibility.

Before activation, verify the selected information-form hosts, zero-SOL fee sponsorship and one complete
eligible card → confirmed USDC → supported Singapore merchant payment → receipt → bill journey. The dashboard
POS test can move real funds: do not treat it as a simulated sandbox. Native merchant signing/card funding
remain disabled until device testing. A participating merchant is required; this does not enable arbitrary
national QR codes. Hosted forms retain their provider disclosures; normal Frenspay screens omit provider branding.

Checks: `yarn check:payments`, `yarn check:payments:browser`, `yarn check:expenses:db`, and web/backend/mobile
TypeScript checks. The merchant tests use isolated PGlite and mocked provider/RPC responses; no live funds move.
Watch `merchant_payment_completed`, `merchant_payment_failed`, `merchant_payment_retry` and
`merchant_payment_receipt_wait` metrics. Inspect aging `merchant_payments.status='processing'` records if
receipt verification stalls. Disable new payments with `MERCHANT_PAY_ENABLED=false`; the reconciler continues
existing signed attempts. Never retry a payment with a new provider invoice solely because confirmation timed out.

Sources: [Wallet SDK](https://docs.walletconnect.com/payments/wallets/standalone/web),
[Solana signing](https://docs.walletconnect.com/payments/wallets/token-chain-support/solana-support),
[funding setup](https://docs.privy.io/financial-flows/deposits/configuration).
