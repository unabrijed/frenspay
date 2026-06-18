# Pay — monorepo

Yarn-workspaces monorepo for **Pay**, a travel payments app (hold USD, spend INR at a
locked rate via UPI QR, plus send/request with friends). Web is served by the Expo app
itself (react-native-web), so there is no separate web project.

```
monorepo/
  apps/
    mobile/     Expo / React Native app (iOS, Android, web)
    backend/    Fastify API service (deploys on Railway)
  packages/
    shared/     money math + API contract types, used by both apps
```

> Project docs (`backend-architecture.md`, `india-legal-compliance-brief.md`,
> `design-reference/`) live one level up in the `payments/` root, not in this repo.

---

## TL;DR — can I test it right now?

| Path | Setup needed | Status |
|---|---|---|
| **Mock mode** (full UI, fake money) | none | ✅ **works now** — `yarn mobile` |
| **Real mode — reads** (identity, activity, requests) | backend + DB | ✅ works now (DB is live) |
| **Real mode — balance + Send** (on-chain USDC) | backend + DB + `devnet:setup` | ⏳ blocked on funding the devnet fee-payer |

So: you can walk **every screen and flow today in mock mode** with zero setup. The real
backend reads work too. Real **balance/Send** light up the moment `devnet:setup` runs
(see [the gate](#gate--one-time-devnet-setup) below).

---

## Prerequisites

```bash
nvm use            # Node 22 (repo pins it via .nvmrc; Expo 56 wants Node 20/22 LTS)
corepack enable    # honors the pinned Yarn (yarn@1.22.22)
yarn install       # run from this monorepo/ directory
```

Plus one of: **Xcode** (for the iOS Simulator) or the **Expo Go** app on your phone.
No EAS, no Apple/Google developer account needed to develop and test.

---

## The two modes

The app runs against a `WalletProvider` seam. One env flag picks the implementation —
**no UI changes between modes** (`apps/mobile/src/services/wallet.ts`):

| | **Mock** (default) | **Real** |
|---|---|---|
| Flag | `EXPO_PUBLIC_USE_REAL_API` unset or `0` | `EXPO_PUBLIC_USE_REAL_API=1` |
| Backend | none | `apps/backend` on `:3001` |
| Money | local math (`$420` seed) | DB + Solana devnet USDC |
| Runs in | Expo Go / Simulator / web | same (dev-keypair path) |

---

## A — Test now (mock mode, zero setup)

```bash
yarn mobile          # start Expo
#   press i  → iOS Simulator (needs Xcode)
#   scan QR  → Expo Go on your phone
yarn mobile:web      # or run it in the browser
```

Walk anything: onboarding (Welcome → Face ID → handle → fund), Home (INR/USD toggle,
rate-lock card), Send / Request, Add money, Pay (scan → amount → review → success),
Activity + transaction detail. All money is local mock math.

Reset state: **Settings → Replay onboarding**, or clear the app's data / reinstall in
Expo Go (state persists in AsyncStorage).

---

## B — Test real mode (dev keypair, Expo Go)

This proves the real chain end-to-end **without** Privy or a dev client. The app
authenticates with a seeded user (`x-dev-user-id`) and signs with a local devnet keypair.

### 1. Backend (DB reads — works today)

```bash
# apps/backend/.env already has DATABASE_URL (Railway) + PORT=3001
yarn workspace @pay/backend db:init      # apply the schema (idempotent)
yarn workspace @pay/backend db:seed      # 2 users (@bridge, @neha) + sample activity
                                         #   ↳ copy the printed @bridge user id
yarn backend                             # boots on http://localhost:3001
curl localhost:3001/health               # → {"status":"ok","database":"configured"}
```

### Gate — one-time devnet setup

Real **balance + Send** need an on-chain USDC mint and funded test wallets. This step is
**currently blocked**: the public devnet faucet is rate-limited (`429`), so the fee-payer
must be funded manually first.

```bash
# 1. Fund the fee-payer with ~1 devnet SOL (only ~0.01 is actually used):
#       address: 47mWnfd9s5vHGgBbhMJaW6Y1VHQb2B1398teMXUnackC
#    via https://faucet.solana.com (Devnet), or a Helius devnet RPC.
# 2. Provision the mint + fund @bridge/@neha wallets:
yarn workspace @pay/backend devnet:setup
# 3. Copy the printed USDC_MINT (and confirm FEE_PAYER_SECRET_KEY) into apps/backend/.env,
#    then restart `yarn backend`.
```

`devnet:setup` writes `apps/backend/.devnet/keys.json` (the test-wallet secret keys) and
points the seeded users at real devnet addresses.

### 2. Mobile (point the app at the backend)

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

Edit `apps/mobile/.env`:

```bash
EXPO_PUBLIC_USE_REAL_API=1
EXPO_PUBLIC_API_URL=http://localhost:3001        # see the networking cheatsheet below
EXPO_PUBLIC_DEV_USER_ID=<@bridge id from db:seed>
EXPO_PUBLIC_DEV_SECRET_KEY=<@bridge secretKey from .devnet/keys.json>
```

```bash
yarn mobile -c       # -c clears the cache so the new env is picked up
```

### 3. Verify

- Home balance shows the funded amount (e.g. `1000 USDC` → USD).
- Send `@bridge → @neha` returns a **devnet signature** (viewable on Solana Explorer,
  devnet) and the `transfers` row flips `pending → confirmed` (poller in
  `services/confirmer.ts`).
- Activity reflects the new transfer on next refresh.

---

## Networking + env cheatsheet

`EXPO_PUBLIC_API_URL` must be reachable **from where the app runs** (the backend binds
`0.0.0.0`, so the LAN works):

| Running on | `EXPO_PUBLIC_API_URL` |
|---|---|
| iOS Simulator | `http://localhost:3001` |
| Android emulator | `http://10.0.2.2:3001` |
| Physical phone (Expo Go) | `http://<your-Mac-LAN-IP>:3001` (localhost won't reach the Mac) |

> `EXPO_PUBLIC_*` vars are **inlined at start**. After editing `apps/mobile/.env`, restart
> with `yarn mobile -c`. The current backend runs on **`:3001`** (per `apps/backend/.env`),
> not the `:3000` shown in the example files.

---

## Privy auth (follow-on, production-like)

The dev-keypair path above skips real auth. For email-OTP login + an embedded Solana
wallet, set `EXPO_PUBLIC_PRIVY_APP_ID` (+ `EXPO_PUBLIC_PRIVY_CLIENT_ID`) and the backend
`PRIVY_APP_ID/SECRET`. Privy uses native modules, so it requires a **local dev client**
(`npx expo prebuild` + `npx expo run:ios`, needs Xcode) — Expo Go is no longer used once
Privy is on. The Privy code is lazy-loaded and stays out of the Expo Go bundle when the
flag is unset. See `apps/backend/README.md` and milestone **M3** in the plan.

---

## Commands

| Command | What |
|---|---|
| `yarn mobile` | Start the Expo app (`i` = iOS Simulator, or scan with Expo Go) |
| `yarn mobile -c` | Start Expo with a cleared cache (use after editing `.env`) |
| `yarn mobile:web` | Run the app in the browser |
| `yarn backend` | Start the Fastify API in watch mode (`http://localhost:3001`) |
| `yarn typecheck` | Type-check all three workspaces |
| `yarn workspace @pay/backend db:init` | Apply `src/db/schema.sql` (idempotent) |
| `yarn workspace @pay/backend db:seed` | Insert 2 test users + sample activity (prints ids) |
| `yarn workspace @pay/backend devnet:setup` | Provision fee-payer + USDC mint + funded wallets |
| `yarn workspace @pay/<app> <cmd>` | Run any script in a specific workspace |

---

## Troubleshooting

- **App can't reach the backend** — using a physical phone? `localhost` points at the
  phone, not your Mac. Use your Mac's LAN IP (`http://192.168.x.x:3001`) and make sure both
  are on the same Wi-Fi.
- **Env changes don't take effect** — `EXPO_PUBLIC_*` is inlined at start; restart
  `yarn mobile -c`.
- **`/balance` is 0 / Send errors with "no mint"** — `devnet:setup` hasn't run (or
  `USDC_MINT` isn't in `apps/backend/.env`). See [the gate](#gate--one-time-devnet-setup).
- **Faucet `429 Too Many Requests`** — the public devnet faucet is rate-limited/dry; fund
  the fee-payer via https://faucet.solana.com or a Helius devnet RPC instead.
- **Postgres `28P01 password authentication failed`** — the `DATABASE_URL` password is
  stale; copy the live `DATABASE_PUBLIC_URL` from the Railway Postgres **Variables** tab.

---

## Deploy

The backend deploys on **Railway** (Nixpacks, `railway.json`, Node pinned via `.nvmrc`).
Full steps + the env-var checklist live in [`apps/backend/README.md`](./apps/backend/README.md).

## Cost note
Everything here is free to develop with: Solana **devnet**, Helius free RPC, Privy free
tier, the Railway free/low trial tier, and the free **Expo Go / iOS Simulator** workflow
(no EAS). Store fees ($99/yr Apple, $25 Google) only apply when publishing to a store.
