# @fpay/web

The fpay **web app** — a **Next.js 15 (App Router)** mobile-first port of the mobile UI. It
renders as a **fixed phone column that never widens** on desktop/tablet, reuses `@fpay/shared`
+ the same store/services as mobile, and uses Privy's **browser** SDK so email-OTP login +
an embedded Solana wallet work **with no device or dev build**.

## Run

```bash
# from the monorepo root (Node 24 — `nvm use` first)
yarn dev:web                          # web :3000 + backend :3001
yarn workspace @fpay/web build         # production build
yarn workspace @fpay/web start         # serve the production build
yarn workspace @fpay/web tsc --noEmit  # typecheck just this app
```

**There is no mock mode** — the app always talks to the real backend. With an empty `.env.local`
you get the shell and nothing more: Privy never mounts, requests go out unauthenticated and come
back 401, and the first send throws *"No active signer configured"*. Pick one of the two paths.

Customer access uses email OTP and invited f-list membership. There is no customer access key.
The landing form joins the f-list, then hands the email to the app in a URL fragment. The app
removes the fragment, sends an OTP, and verifies membership before mounting either existing UI.
Direct visitors can enter an invite in the app after verifying their email. The reusable
`/invites` page ("Invite a fren") reads codes only through authenticated `GET /flist/me`.

## Signing in

**Privy** (email OTP + an embedded Solana wallet) — in `apps/web/.env.local`, see `.env.example`:

```bash
NEXT_PUBLIC_APP_ENV=stage
NEXT_PUBLIC_STAGE_API_URL=http://localhost:3001
NEXT_PUBLIC_PRIVY_APP_ID=<your Privy app id>   # bare on every tier — one Privy app everywhere
# NEXT_PUBLIC_PRIVY_CLIENT_ID=<optional>
```

Then **allow `http://localhost:3000` as an origin in your Privy dashboard app** and reload —
`yarn dev:web` already runs the backend. The Privy **App Secret is backend-only** — `PRIVY_APP_SECRET` lives in
`apps/backend/.env`, never here.

**Or a seeded dev wallet**, which is faster for local work — set
`NEXT_PUBLIC_STAGE_DEV_USER_ID` + `NEXT_PUBLIC_STAGE_DEV_SECRET_KEY` from
`apps/backend/.devnet/keys.json` after `db:seed`. It runs under `next dev` only:
the key is a raw private key, so `envConfig.ts` reads it inside a branch every production build
strips. Full notes in `.env.example` and the [root README](../../README.md#web-app-appsweb).

## Notes
- Env mirrors the stage convention: `NEXT_PUBLIC_APP_ENV` selects the prefix, values read
  under `NEXT_PUBLIC_STAGE_*` (`src/services/envConfig.ts` — the one place this app reads env,
  and the reference copy of the tier block every app shares). Next only inlines **static literal**
  `process.env.NEXT_PUBLIC_*` references, which is why it can't move into `@fpay/shared`.
  `yarn check:env` guards the drift.
- Privy Solana peer deps (`@solana/kit`, `@solana-program/*`) are installed with
  `--ignore-engines` (they demand Node ≥24 but are browser-bundled); `next.config.ts` stubs
  Privy's unused `@stripe/crypto` + `@farcaster/mini-app-solana` imports.
- Middleware retains the existing early-access route redirects. The LP console alone retains
  its access-key gate (`yarn check:gate`).
- Browser behavior checks use real React components with mocked Privy and HTTP. Install test
  tools into a scratch directory with Yarn, then run:
  `INVITE_PLAYWRIGHT_MODULE=/absolute/path/to/@playwright/test/index.mjs yarn workspace @fpay/web check:invites:browser`.
  The check uses locally installed Chrome and never sends a real OTP.
