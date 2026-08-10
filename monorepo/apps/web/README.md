# @fpay/web

The Pay **web app** — a **Next.js 15 (App Router)** mobile-first port of the mobile UI. It
renders as a **fixed phone column that never widens** on desktop/tablet, reuses `@fpay/shared`
+ the same store/services as mobile, and uses Privy's **browser** SDK so email-OTP login +
an embedded Solana wallet work **with no device or dev build**.

## Run

```bash
# from the monorepo root (Node 22 — `nvm use` first)
yarn dev:web                          # web :3000 + backend :3001  (mock mode)
yarn workspace @fpay/web build         # production build
yarn workspace @fpay/web start         # serve the production build
yarn workspace @fpay/web tsc --noEmit  # typecheck just this app
```

Mock mode (default) needs **zero setup** — walk the whole app in the browser: onboarding,
Home (INR/USD toggle), Send/Request/Add/Pay sheets, Activity, Detail, Settings.

## Real mode (Privy + on-chain USDC)

In `apps/web/.env.local` (see `.env.example`):

```bash
NEXT_PUBLIC_APP_ENV=stage
NEXT_PUBLIC_STAGE_USE_REAL_API=1
NEXT_PUBLIC_STAGE_API_URL=http://localhost:3001
NEXT_PUBLIC_STAGE_PRIVY_APP_ID=<your Privy app id>
# NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID=<optional>
```

Then **allow `http://localhost:3000` as an origin in your Privy dashboard app** and reload —
`yarn dev:web` already runs the backend. The Privy **App Secret is backend-only** — it lives in
`apps/backend/.env`, never here.

## Notes
- Env mirrors the stage convention: `NEXT_PUBLIC_APP_ENV` selects the prefix, values read
  under `NEXT_PUBLIC_STAGE_*` (`src/services/envConfig.ts` — the one place this app reads env,
  and the reference copy of the tier block every app shares). Next only inlines **static literal**
  `process.env.NEXT_PUBLIC_*` references, which is why it can't move into `@fpay/shared`.
  `yarn check:env` guards the drift.
- Privy Solana peer deps (`@solana/kit`, `@solana-program/*`) are installed with
  `--ignore-engines` (they demand Node ≥24 but are browser-bundled); `next.config.ts` stubs
  Privy's unused `@stripe/crypto` + `@farcaster/mini-app-solana` imports.
