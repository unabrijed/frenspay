# fpay — monorepo

Yarn-workspaces monorepo for **fpay**, a travel payments app (hold USD, spend INR at a
locked rate via UPI QR, plus send/request with friends). Three Next.js frontends — the
**web app**, an operator **console**, and the **landing** page — share one backend, design
system, and business logic. An Expo **mobile app** renders the same product natively.

```
monorepo/
  apps/
    web/        Next.js (App Router) web app — mobile-first, runs in any browser
    mobile/     Expo / React Native app — the same product on a phone (see below)
    backend/    Fastify API service (runs on Railway, from an image built in CI)
    admin/      Next.js operator console — admin.frenspay.xyz
    lp/         Next.js LP console — the marketplace side
    landing/    Static Next export — frenspay.xyz (Tailwind v4; web/admin are v3)
  packages/
    shared/     money math + API contract types, used by all apps
    ui/         the design system — used by web + lp + mobile (.native twins for the phone)
    app/        the product — store, API client, sheets, components; used by web + mobile
  brand/        logo source + `yarn brand` — generates every app icon (see brand/README.md)
```

> **Adding a workspace? Add its `package.json` to the repo-root `Dockerfile` too.** Every
> workspace's manifest must reach the install layer, even ones the backend never imports — workspace
> deps resolve from the tree, not the lockfile, so a missing one makes yarn look on npm and the
> image build dies. `packages/ui` broke it exactly this way.

> One level up, in the `payments/` root: the build files this repo deploys with (`Dockerfile`,
> `.dockerignore`, `.github/workflows/`) plus `backend-architecture.md` and
> `india-legal-compliance-brief.md`. The git root is `payments/`, not `monorepo/` — which is why
> every path inside those build files is `monorepo/`-prefixed.

---

## Prerequisites

```bash
nvm use            # Node 24 (repo pins it via .nvmrc)
corepack enable    # honors the pinned Yarn (yarn@1.22.22)
yarn install       # run from this monorepo/ directory
```

> Run everything under **Node 24** (`@solana-program/token` needs ≥24; the repo's own `Dockerfile`
> is `node:24-slim` and the Vercel projects are pinned to it too). `nvm use` first.

---

## Quick start — the commands

All commands run from the **monorepo root**.

**One rule: every `dev:*` starts that frontend _plus_ the backend it talks to.** One command, one
terminal, no "now open a second tab and start the API".

All three frontends do talk to it, so all three start it:

- **web** — everything. Auth, balance, activity, quotes, orders.
- **admin** — the operator console is backend reads end to end; it has no other data source.
- **landing** — it is a *static export* with no database of its own. The f-list form POSTs to
  `${API_URL}/waitlist`, so the signup you are testing reaches Postgres through the backend or not
  at all.

Starting it is cheap even when you only want to look at a page: the backend boots **without a
database** (pools are created lazily, `/health` reports `"database":"none"`). You only feel a
missing Postgres at the moment something tries to write.

| Command | Starts | Ports |
|---|---|---|
| `yarn dev` | **Everything** — backend + web + admin + landing | 3001 · 3000 · 3002 · 3003 |
| `yarn dev:web` | **Web app** + backend | 3000 · 3001 |
| `yarn dev:fpay` | Same as `yarn dev:web` | 3000 · 3001 |
| `yarn dev:admin` | **Operator console** + backend | 3002 · 3001 |
| `yarn dev:landing` | **Landing page** + backend (the f-list form POSTs to it) | 3003 · 3001 |
| `yarn dev:lp` | **LP console** + backend | 3004 · 3001 |
| `yarn dev:backend` | **API** alone, in watch mode | 3001 |

Ctrl-C stops the whole group; nothing is left holding a port.

| Everything else | |
|---|---|
| `yarn brand` | Regenerate every derived asset — app icons, the social card, the X avatar — from `brand/logo-icon.svg` |
| `yarn typecheck` | Type-check **every** workspace (shared + ui + backend + web + admin + lp + landing) |
| `yarn check:all` | Every self-check below, in one go (~12s, no DB, no network) |
| `yarn check:deploy` | The path gate that decides what a push deploys — see [Deploy](#deploy) |
| `yarn db:migrate` | Apply pending DB migrations (`yarn db:status` to inspect, `db:seed` · `db:reset` · `db:new` · `db:init` · `db:deploy` all exist too) |
| `yarn db:seed` | Insert 2 test users (@bridge, @neha) + sample activity (prints ids) |
| `yarn check:env` | Tier block identical across the Next apps, nothing reads `process.env` outside an `envConfig.ts` |
| `yarn check:paytarget` | The pay-target parser — handles, VPAs, phones, addresses |
| `yarn check:rails` | Chain-registry invariants + suffix resolution |
| `yarn check:waitlist` | The f-list share codes + confirm tokens |
| `yarn check:scenes` | Landing scenes share a horizon; foot chrome clears AA contrast |
| `yarn check:email` | The email rules the f-list form depends on |
| `yarn workspace @fpay/<app> <cmd>` | Run any script in a specific workspace |

Every repo-level tool is typed the short way. The deliberate exception is per-app **`build`** and
**`start`** — the Vercel configs (the root `vercel.json` for web, `apps/{admin,lp,landing}/vercel.json`),
the repo-root `Dockerfile`'s `CMD` (`db:deploy && start`), and `.githooks/pre-push` run those exact
strings, so a root alias would be a second way to say something deploy config already says one way,
and the two can drift.

> **`yarn dev:mobile` starts Metro only**, in its own terminal — Expo's keypress menu breaks under the
> `dev:*` fan-out. Run `yarn dev:backend` beside it, or point the app at stage; see
> [Mobile app](#mobile-app-appsmobile).

---

## Web app (`apps/web`)

```bash
yarn dev:web          # → web on :3000 + backend on :3001
yarn workspace @fpay/web build   # production build
yarn workspace @fpay/web tsc --noEmit   # typecheck just the web app
```

Mobile-first by design: it renders as a **fixed phone column that never widens** on
desktop/tablet.

**There is no mock mode.** The app always talks to the real backend, so it needs a way to sign in
and a way to sign. With an empty `.env.local` you get the shell and nothing else: Privy never
mounts, requests go out unauthenticated and come back 401, and the first send throws
*"No active signer configured"*. Pick one of the two paths below.

**Privy (email OTP + an embedded Solana wallet, no device needed)** — `apps/web/.env.local`:

```bash
NEXT_PUBLIC_APP_ENV=stage
NEXT_PUBLIC_STAGE_API_URL=http://localhost:3001
NEXT_PUBLIC_STAGE_PRIVY_APP_ID=<your Privy app id>
# NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID=<optional>
```

Then **allow `http://localhost:3000` as an origin in your Privy dashboard app** and reload —
`yarn dev:web` is already running the backend. (The App **Secret** is backend-only — never put it here.)

**No Privy — sign as a seeded dev wallet.** Faster for local work; needs `db:seed` to have run
and a keypair in `apps/backend/.devnet/keys.json` (mainnet, so it holds real USDC or none):

```bash
NEXT_PUBLIC_STAGE_DEV_USER_ID=<a seeded user id>
NEXT_PUBLIC_STAGE_DEV_SECRET_KEY=<that user's secret key array>
```

The id rides as `x-dev-user-id`, which the backend honours **only** when it is running locally and
Privy is unconfigured. `DEV_SECRET_KEY` is a raw private key and every `NEXT_PUBLIC_*` is inlined
into the browser bundle, so `envConfig.ts` reads both inside a dead `isProduction` branch that any
production build strips — meaning this path works under `next dev` only, never on a deployed stage.
`yarn check:env` asserts the stripping rather than trusting it. Full notes in `apps/web/.env.example`.

---

## Mobile app (`apps/mobile`)

The same product as the web app, on a phone: Expo / React Native rendering `@fpay/app` over
`@fpay/ui`'s native renderer — see [docs/12](docs/12-mobile-app.md) for the shape. Android first.

**Privy needs a dev build** (Expo Go can't run its native modules), and there is no EAS: the build
is local and free. The phone connects over **wireless adb** (Android 11+: Developer options →
Wireless debugging → Pair device with pairing code):

```bash
adb pair <phone-ip>:<pairing-port>          # once, with the code the phone shows
adb connect <phone-ip>:<port>               # each session; `adb devices` should list it
cp apps/mobile/.env.example apps/mobile/.env   # fill the Privy app id + NATIVE client id
yarn workspace @fpay/mobile android         # prebuild (once) + Gradle build + install + Metro
```

After the first install, `yarn dev:mobile` (Metro only, its own terminal) is enough; the dev
client reconnects. It stays out of `yarn dev`: Expo needs its own terminal or its keypress menu
(`a` / `r`) stops working. **Always launch from the repo root or `apps/mobile`** — never
`npx expo` from a random directory, or Expo resolves the wrong entry. A clean cache is
`yarn workspace @fpay/mobile start -- -c`.

The app talks to **stage** by default (`EXPO_PUBLIC_STAGE_API_URL` in `.env.example`); for a local
backend, leave `EXPO_PUBLIC_LOCAL_API_URL` blank and it finds the Mac's LAN IP from Metro.

**Bridge-gated before the first real pass:** a Privy **app client** for `com.bridge.fpay` (the
native client id); for push, a free Expo project id in `app.json` (`extra.eas.projectId`) plus the
Firebase FCM V1 key uploaded to it; for passkeys, `/.well-known/assetlinks.json` on frenspay.xyz.

---

## Backend (`apps/backend`)

```bash
cp apps/backend/.env.example apps/backend/.env   # then fill STAGE_DATABASE_URL etc.
yarn db:migrate                                  # apply pending DB migrations
yarn db:seed                                     # 2 test users + sample activity (prints ids)
yarn dev:backend                                 # → http://localhost:3001
curl localhost:3001/health                       # → {"status":"ok","database":"configured"}
```

On-chain **balance + Send** need a funded mainnet fee-payer (`STAGE_FEE_PAYER_SECRET_KEY`); without
one local is read-only for money. There is no testnet. Details + endpoints + deploy steps live in
[`apps/backend/README.md`](./apps/backend/README.md).

---

## Money convention

Every amount is a **decimal string** at rest and on the wire, a BigNumber inside a calculation, and a
`number` only when printed. Never `parseFloat` an amount, never write `1e6`, never compare two of
them with a bare `<`. The whole rule, with the reasons and the costs, is
[docs/01 § Money & decimals](docs/01-architecture.md#money--decimals). The code is
`packages/shared/src/units.ts`, and `yarn check:money` enforces it.

## Env convention (`NODE_ENV` / stage prefix)

`NODE_ENV` selects a **prefix**, and every value is read under it — `stage → STAGE_*`. Same
logical keys, one place to switch environments later. The web app is the exception: Next
*forces* `NODE_ENV`, so its tier comes from `NEXT_PUBLIC_APP_ENV` instead.

Every app reads env through exactly one file, all named `envConfig.ts` and all resolving the same
three tiers:

| Surface | Stage selector | Var pattern | Read in |
|---|---|---|---|
| Backend | `NODE_ENV=stage` | `STAGE_DATABASE_URL`, `STAGE_PRIVY_APP_SECRET`, … | `apps/backend/src/envConfig.ts` |
| Web | `NEXT_PUBLIC_APP_ENV=stage` | `NEXT_PUBLIC_STAGE_*` | `apps/web/src/services/envConfig.ts` |
| Admin | `NEXT_PUBLIC_APP_ENV=stage` | `NEXT_PUBLIC_STAGE_*` | `apps/admin/src/services/envConfig.ts` |
| Landing | `NEXT_PUBLIC_APP_ENV=stage` | `NEXT_PUBLIC_STAGE_*` | `apps/landing/src/lib/envConfig.ts` |
| Mobile | `EXPO_PUBLIC_APP_ENV=stage` | `EXPO_PUBLIC_STAGE_*` | `apps/mobile/src/services/envConfig.ts` |

The three Next apps and the Expo app carry a byte-identical tier block (mobile's under its own prefix). That duplication is forced, not sloppy:
Next only inlines **literal** `process.env.NEXT_PUBLIC_*` references appearing in the app's own
source, and the backend may only `import type` from `@fpay/shared`. `yarn check:env` asserts the
blocks stay identical and that nothing reads `process.env` outside an `envConfig.ts`.

Two kinds of vars sit outside the `NEXT_PUBLIC_*` pattern: host-level ones (`PORT` — the platform
injects it, `PUBLIC_BASE_URL`), and the web deploy access gate's server-only keys
(`STAGE_ACCESS_KEY` on the stage Vercel project / bare `ACCESS_KEY` on prod — read by
`apps/web/src/middleware.ts`, never inlined into a browser bundle). See each app's `.env.example`
and `DEPLOY.stage.md`.

---

## Networking cheatsheet (mobile app against a local backend)

The app defaults to stage. To hit a local backend, `EXPO_PUBLIC_LOCAL_API_URL` must be reachable
**from where the app runs** (the backend binds `0.0.0.0`); blank = the Mac's LAN IP from Metro:

| Running on | `EXPO_PUBLIC_LOCAL_API_URL` |
|---|---|
| iOS Simulator | `http://localhost:3001` |
| Android emulator | `http://10.0.2.2:3001` |
| Physical phone | `http://<your-Mac-LAN-IP>:3001` (localhost won't reach the Mac) |

The web app (browser on the same machine) just uses `http://localhost:3001`.

---

## Testing

```bash
yarn typecheck        # tsc --noEmit across all five workspaces
yarn check:all        # every self-check below, stops at the first failure
```

`check:all` is the closest thing to a test suite: fourteen plain assert scripts, **no DB and no
network**, about twelve seconds end to end. Run one on its own when you know what you touched —
`check:deploy` · `check:env` · `check:money` · `check:paytarget` · `check:rails` · `check:kyb` ·
`check:routing` · `check:fx` · `check:waitlist` · `check:invites` · `check:scenes` · `check:email` ·
`check:api` · `check:api:lp`.

`check:deploy` is the one to run after touching anything that moves a file between apps: it asserts
the path gate in `scripts/vercel-ignore.mjs`, which is the **single** thing deciding what a push
deploys — every Vercel project via `ignoreCommand`, and the backend image via the CI workflow. Add a
scope there when you add a deploy target; a second filter elsewhere is how these drift apart.

`check:money` is the one to run after touching anything that carries an amount: it covers the
parse/format round-trip, the rounding law, the backend mirror of `units.ts`, and the two traps the
compiler can't see (`<` on two decimal strings compares them lexically; `+` concatenates).

End-to-end smoke tests are manual: walk the flow in the browser (`yarn dev:web`), and hit the
backend with `curl localhost:3001/health` plus the endpoints in the backend README.

---

## Troubleshooting

- **Env changes don't take effect** — `NEXT_PUBLIC_*` is inlined at start, not read at runtime;
  restart `yarn dev:web`.
- **Every route shows an "Enter your access key" form** — the deploy access gate is on because
  `STAGE_ACCESS_KEY` is set in `apps/web/.env.local`. Enter that value once, or remove the line
  (unset = gate off, the local default). On a stage/prod domain that form is correct behavior.
- **Privy login rejected on web** — add `http://localhost:3000` as an allowed origin in the
  Privy dashboard app; confirm `NEXT_PUBLIC_STAGE_PRIVY_APP_ID` is set.
- **`/balance` is 0** — the wallet holds no mainnet USDC yet; deposit some to the address in Add money.
- **Send 503s `solana_unavailable`** — no `STAGE_FEE_PAYER_SECRET_KEY` locally (money is read-only) or the RPC is rate-limiting; use a Helius RPC url.

Mobile app:

- **App can't reach the backend** — on a physical phone `localhost` is the phone, not your Mac.
  Use the Mac's LAN IP and the same Wi-Fi. The web app uses `localhost:3001`.
- **`EXPO_PUBLIC_*` changes don't take effect** — restart with a cleared cache
  (`yarn workspace @fpay/mobile start -- -c`).
- **`expo run:android` finds no device** — `adb connect <phone-ip>:<port>` first (wireless
  debugging); `adb devices` should list it. USB never worked on this Mac.

---

## Deploy

Backend on **Railway** (Supabase Postgres), frontends on **Vercel** — one project per app per
environment (`stage` branch → stage projects, `sacred` → prod). The deployed web app sits behind a
shared **access-key gate** until launch. The runbooks — every dashboard setting, variable, domain
step, and test — are [`DEPLOY.stage.md`](./DEPLOY.stage.md) (start here) and
[`DEPLOY.md`](./DEPLOY.md) (prod/mainnet).

**Nothing is published to a registry.** A push to `stage` runs
`.github/workflows/backend-image.yml`, which `railway up`s this checkout; Railway builds the
repo-root `Dockerfile` (`node:24-slim`) on its own builder. The service has no GitHub connection, so
no push can trigger a build there directly — CI is the only path. Full model:
[`DEPLOY.stage.md`](./DEPLOY.stage.md) §How a deploy happens. Two consequences worth knowing before
you deploy:

- **The frontends can go live before the backend** — a Railway build is 3–5 minutes, a Next build
  2–3. That is the pairing that breaks (old frontend + new backend is fine; the reverse is not), so
  keep backend API changes backward-compatible for one deploy cycle.
- **What deploys is decided by one file**, `scripts/vercel-ignore.mjs` (`yarn check:deploy`), for
  both Vercel and the backend. A docs-only push deploys nothing.

## Cost note
Everything here is free to develop with: Solana mainnet reads, Helius free RPC, Privy free
tier, Railway's Hobby plan, GitHub Actions (metered on a private repo — 2,000 min/month — but this
workflow only uploads, so it barely registers), Vercel's free Hobby tier for the frontends, and the
free **web** workflow (no EAS needed — the Android dev build is local + free; Expo's push service
and a Firebase project for FCM are free too).

> The one recurring cost is Railway **build** compute, billed as ordinary usage at roughly a cent
> per build against the Hobby plan's $5 monthly credit. Building in Actions and having Railway pull
> would be faster and free — but it needs a **public** image, because Railway gates private-registry
> pulls behind **Pro**, and a public image is a published codebase. `DEPLOY.stage.md` §How a deploy
> happens.
