# fpay — monorepo

Yarn-workspaces monorepo for **fpay**, a travel payments app (hold USD, spend INR at a
locked rate via UPI QR, plus send/request with friends). There are **two frontends** — a
Next.js **web app** and an Expo **mobile app** — sharing one backend, design system, and
business logic.

```
monorepo/
  apps/
    web/        Next.js (App Router) web app — mobile-first, runs in any browser
    mobile/     Expo / React Native app (iOS, Android)
    backend/    Fastify API service (deploys on Railway)
    admin/      Next.js operator console — admin.frenspay.xyz
    landing/    Static Next export — frenspay.xyz (Tailwind v4; web/admin are v3)
  packages/
    shared/     money math + API contract types, used by all apps
  brand/        logo source + `yarn brand` — generates every app icon (see brand/README.md)
```

> Project docs (`backend-architecture.md`, `india-legal-compliance-brief.md`,
> `design-reference/`) live one level up in the `payments/` root, not in this repo.

---

## Prerequisites

```bash
nvm use            # Node 22 (repo pins it via .nvmrc)
corepack enable    # honors the pinned Yarn (yarn@1.22.22)
yarn install       # run from this monorepo/ directory
```

> Run everything under **Node 22**. (The default Node 25 mostly works, but the repo is
> pinned to 22 — `nvm use` first.)

---

## Quick start — the commands

All commands run from the **monorepo root**.

| Command | What it does |
|---|---|
| `yarn web` | **Web app** → http://localhost:3000 (mock mode by default) |
| `yarn mobile` | **Mobile app** via Expo (scan the QR with Expo Go, or `i`/`a` for a simulator) |
| `yarn mobile -- -c` | Mobile with a cleared cache (use after editing `apps/mobile/.env`) |
| `yarn backend` | **API** in watch mode → http://localhost:3001 |
| `yarn admin` | **Operator console** → http://localhost:3002 |
| `yarn landing` | **Landing page** → http://localhost:3003 |
| `yarn brand` | Regenerate every app icon from `brand/logo-mark.svg` |
| `yarn typecheck` | Type-check **all six** workspaces (shared + mobile + backend + web + admin + landing) |
| `yarn workspace @fpay/backend db:init` | Apply the DB schema (idempotent) |
| `yarn workspace @fpay/backend db:seed` | Insert 2 test users (@bridge, @neha) + sample activity (prints ids) |
| `yarn workspace @fpay/backend devnet:setup` | Provision fee-payer + USDC mint + funded devnet wallets |
| `yarn workspace @fpay/backend check:waitlist` | Self-check the f-list share codes + confirm tokens (no DB, no network) |
| `yarn workspace @fpay/<app> <cmd>` | Run any script in a specific workspace |

> `yarn start` is an alias for `yarn mobile`. **Always launch from the repo root** (never
> `expo start` / `npx expo` from a random directory — Expo resolves the wrong entry).

---

## Web app (`apps/web`)

```bash
yarn web              # → http://localhost:3000  (mock mode, zero setup)
yarn workspace @fpay/web build   # production build
yarn workspace @fpay/web tsc --noEmit   # typecheck just the web app
```

Mobile-first by design: it renders as a **fixed phone column that never widens** on
desktop/tablet. Click through the whole app in mock mode — onboarding, Home (INR/USD
toggle), Send/Request/Add/Pay sheets, Activity, Detail, Settings — with no backend.

**Real mode (Privy login + on-chain USDC, no device needed):** Privy's browser SDK runs
email-OTP + an embedded Solana wallet right in the page. In `apps/web/.env.local`:

```bash
NEXT_PUBLIC_APP_ENV=stage
NEXT_PUBLIC_STAGE_USE_REAL_API=1
NEXT_PUBLIC_STAGE_API_URL=http://localhost:3001
NEXT_PUBLIC_STAGE_PRIVY_APP_ID=<your Privy app id>
# NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID=<optional>
```

Then **allow `http://localhost:3000` as an origin in your Privy dashboard app**, run
`yarn backend`, and reload. (The App **Secret** is backend-only — never put it here.)

---

## Mobile app (`apps/mobile`)

```bash
yarn mobile           # Expo dev server — scan the QR in Expo Go, or press i / a
```

Mock mode works in **Expo Go** with zero setup. Real mode (dev-keypair path) points the
app at the backend via `apps/mobile/.env` (see the env + networking sections below), then
`yarn mobile -- -c` to pick up the new env.

**Privy on mobile needs a custom dev build** (Expo Go can't run its native modules). On this
machine the Android local build is the path:

```bash
cd apps/mobile
npx expo prebuild --platform android   # generates android/ (one-time)
npx expo run:android                   # builds + installs the dev client (needs an emulator/device)
```

Once installed, the dev client connects to Metro like Expo Go did. (Web is the easier path
for testing Privy — no build, no device.)

---

## Backend (`apps/backend`)

```bash
cp apps/backend/.env.example apps/backend/.env   # then fill STAGE_DATABASE_URL etc.
yarn workspace @fpay/backend db:init              # apply the schema (idempotent)
yarn workspace @fpay/backend db:seed              # 2 test users + sample activity (prints ids)
yarn backend                                     # → http://localhost:3001
curl localhost:3001/health                       # → {"status":"ok","database":"configured"}
```

On-chain **balance + Send** also need a one-time devnet provisioning (fund the fee-payer,
then `devnet:setup`, then copy the printed `STAGE_USDC_MINT` into `.env`). Details +
endpoints + deploy steps live in [`apps/backend/README.md`](./apps/backend/README.md).

---

## Env convention (`NODE_ENV` / stage prefix)

`NODE_ENV` selects a **prefix**, and every value is read under it — `stage → STAGE_*`. Same
logical keys, one place to switch environments later. The web app is the exception: Next
*forces* `NODE_ENV`, so its tier comes from `NEXT_PUBLIC_APP_ENV` instead.

| Surface | Stage selector | Var pattern | Read in |
|---|---|---|---|
| Backend | `NODE_ENV=stage` | `STAGE_DATABASE_URL`, `STAGE_PRIVY_APP_SECRET`, … | `apps/backend/src/config.ts` |
| Web | `NEXT_PUBLIC_APP_ENV=stage` | `NEXT_PUBLIC_STAGE_*` | `apps/web/src/services/env.ts` |
| Mobile | `NODE_ENV` (Expo forces it) | `EXPO_PUBLIC_STAGE_*` | `apps/mobile/src/services/env.ts` |

`PORT` (backend) stays unprefixed — the host platform injects it. See each app's
`.env.example`.

---

## Networking cheatsheet (mobile real mode)

`EXPO_PUBLIC_STAGE_API_URL` must be reachable **from where the app runs** (the backend binds
`0.0.0.0`):

| Running on | `EXPO_PUBLIC_STAGE_API_URL` |
|---|---|
| iOS Simulator | `http://localhost:3001` |
| Android emulator | `http://10.0.2.2:3001` |
| Physical phone | `http://<your-Mac-LAN-IP>:3001` (localhost won't reach the Mac) |

The web app (browser on the same machine) just uses `http://localhost:3001`.

---

## Testing

```bash
yarn typecheck        # tsc --noEmit across shared + mobile + backend + web
```

End-to-end smoke tests are manual: walk the mock flow in the browser (`yarn web`) or Expo
Go (`yarn mobile`); for real mode, hit the backend with `curl localhost:3001/health` and
the endpoints in the backend README.

---

## Troubleshooting

- **App can't reach the backend (mobile)** — on a physical phone `localhost` is the phone,
  not your Mac. Use the Mac's LAN IP and the same Wi-Fi. The web app uses `localhost:3001`.
- **Env changes don't take effect** — `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` are inlined at start;
  restart `yarn mobile -- -c` / `yarn web`.
- **Privy login rejected on web** — add `http://localhost:3000` as an allowed origin in the
  Privy dashboard app; confirm `NEXT_PUBLIC_STAGE_PRIVY_APP_ID` is set.
- **`/balance` is 0 / Send errors with "no mint"** — `devnet:setup` hasn't run (or
  `STAGE_USDC_MINT` isn't in `apps/backend/.env`).
- **Faucet `429 Too Many Requests`** — the public devnet faucet is rate-limited; fund the
  fee-payer via https://faucet.solana.com or a Helius devnet RPC.
- **`expo run:android` finds no device** — start an Android emulator (or connect a phone
  with USB debugging) first; `adb devices` should list it.

---

## Deploy

The backend deploys on **Railway** (Nixpacks, `railway.json`, Node pinned via `.nvmrc`).
Full steps + the env-var checklist live in [`apps/backend/README.md`](./apps/backend/README.md).

## Cost note
Everything here is free to develop with: Solana **devnet**, Helius free RPC, Privy free
tier, Railway's free/low trial tier, and the free **web / Expo Go** workflow (no EAS needed
for mock mode; the Android dev build is local + free).
