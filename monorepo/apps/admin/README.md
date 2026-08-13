# @fpay/admin

The fpay **ops console** — a **Next.js 15 (App Router)** desktop app for the people running the
service, not for users. Overview, Merchants, Providers, Users, Risk, Invites, Denylist, F list,
Audit, plus an order detail view. It reads the same backend as web through the same client shape
(`src/services/api.ts` mirrors web's), and ships **no wallet and no signing** — it looks and
approves, it never moves money itself.

**Authorization is server-side.** Every `/admin/*` route checks `users.role = 'admin'` (or a match
in `ADMIN_EMAILS`) on the backend. There is no access-key gate in front of this app the way web has
one — the login is the door, and a non-admin who reaches the URL just gets 403s on every panel.
That is also why the deploy has so few knobs: no gate key, no RPC, no wallet config.

## Run

```bash
# from the monorepo root (Node 24 — `nvm use` first)
yarn dev:admin                          # admin :3002 + backend :3001
yarn workspace @fpay/admin build         # production build
yarn workspace @fpay/admin start         # serve the production build
yarn workspace @fpay/admin tsc --noEmit  # typecheck just this app
```

**There is no mock mode** — the console always talks to the real backend. With an empty
`.env.local` it renders the shell and every panel comes back 401.

## Signing in

Two paths, both configured in `apps/admin/.env.local` (see `.env.example`):

**Seeded admin user** — fastest for local work. Set `NEXT_PUBLIC_LOCAL_DEV_USER_ID` to a user id
whose `role` is `'admin'`; the client sends it as `x-dev-user-id` and the backend's dev shim accepts
it. The row must exist — `admin_actions` has an FK to it. Promote a seeded user with SQL, or add the
account's address to `ADMIN_EMAILS` in `apps/backend/.env` and sign in once via Privy. The header is
compiled out of production builds and the backend refuses it outside local anyway.

**Privy** — the same Privy app as web, no wallet involved. Setting the app id is what mounts Privy
(`USE_PRIVY`). Allow `http://localhost:3002` as an origin in the Privy dashboard. The **App Secret
is backend-only** — it lives in `apps/backend/.env`, never here.

## Deploy

The step-by-step runbook — creating the project, the branch-pin script, DNS, the domain steps —
is [`DEPLOY.stage.md` §Frontends](../../DEPLOY.stage.md#frontends--vercel-stage-projects)
(prod: [`DEPLOY.md`](../../DEPLOY.md)). Everything *admin-specific* is below, in full, so this
README doesn't lie by omission.

### Two Vercel projects, one per environment

Vercel's **Production Branch** setting means "the branch whose deploys aren't previews" — it is not
our production. Both admin projects have one; they just point at different branches.

| Vercel project | Production Branch | Root Directory | Variables | Domain |
| -------------- | ----------------- | -------------- | --------- | ------ |
| admin (stage) | `stage` | `monorepo/apps/admin` | `NEXT_PUBLIC_STAGE_*` | the stage admin domain |
| admin (prod) | `sacred` | `monorepo/apps/admin` | bare names, no `APP_ENV` | admin.frenspay.xyz |

Pushing `stage` builds the first, pushing `sacred` builds the second — that separation is the
dashboard branch pin, because both projects share one `apps/admin/vercel.json`.

### Settings

- **Root Directory `monorepo/apps/admin`** (that's what makes Vercel read `apps/admin/vercel.json`),
  with *Include source files outside of the Root Directory* **ON** — install and build run
  `yarn workspace @fpay/admin …` at the workspace root above it. Web is the app that turns that
  toggle OFF; admin can't, and the consequence is the `noop.js` trap below.
- **Node.js Version 24**, **Skip deployment for unaffected projects: Enabled**.
- Never override install/build in the dashboard — they come from `vercel.json`.

### Variables

Admin reads **exactly four keys** (`src/services/envConfig.ts`) and ignores everything else — in
particular it never reads `NEXT_PUBLIC_LANDING_URL`, which the prod runbook lists for the frontends
collectively.

```bash
# stage project
NEXT_PUBLIC_APP_ENV=stage
NEXT_PUBLIC_STAGE_API_URL=https://stage.api.frenspay.xyz
NEXT_PUBLIC_STAGE_PRIVY_APP_ID=<privy app id>
NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID=<optional — see below>

# prod project
NEXT_PUBLIC_API_URL=https://api.frenspay.xyz
NEXT_PUBLIC_PRIVY_APP_ID=<privy app id>
NEXT_PUBLIC_PRIVY_CLIENT_ID=<optional>
# and NO NEXT_PUBLIC_APP_ENV — production is the build default (envConfig.ts)
```

`NEXT_PUBLIC_*` is inlined at build time, so a variable change does nothing until the next deploy:
set variables **then** deploy.

**The client id is optional.** Privy dashboard → your app → Settings → Clients; the client id looks
like `client-…`, the app id is the `cm…` on the same screen. Leaving it unset is supported —
`Providers.tsx` passes `clientId={PRIVY_CLIENT_ID || undefined}` and Privy falls back to the app's
default client. It only matters when you want per-client config. What actually gates login is
adding the admin origin to the Privy app's **allowed origins**.

### Prerequisites — a green build proves nothing on its own

This app is backend reads end to end; it has no other data source.

- The matching backend must be up and its domain resolving. For prod that's the Railway
  `production` environment behind `api.frenspay.xyz`, which is wired up only at mainnet time — until
  then a prod admin deploy builds fine and every panel fails.
- The admin origin must be in that backend's `CORS_ORIGIN` list (`STAGE_CORS_ORIGIN` on stage).
  A missing origin breaks every panel **silently**.
- `ADMIN_EMAILS` (`STAGE_ADMIN_EMAILS` on stage) must be set before anyone signs in — it's the
  lockout recovery path for the `role='admin'` check.

### The `noop.js` trap — fixed, don't undo it

The prod project's first build failed with, *after* a fully green compile of all 14 routes:

```
Error: Cannot find module 'next/dist/compiled/next-server/server.runtime.prod.js'
Require stack:
- /vercel/path0/apps/admin/noop.js
```

`/vercel/path0` is the **git** root (`payments/`), but `next build` records the app dir relative to
`outputFileTracingRoot`. Pinned at the monorepo, that recorded `apps/admin` and `@vercel/next`
looked for Next at `payments/apps/admin`, which doesn't exist. So `next.config.ts` here pins the
**git root** on purpose — that makes the recorded dir `monorepo/apps/admin` and the two roots line
up. It looks inconsistent with web's config and it is meant to be: web's Root Directory is
`monorepo`, so web has nothing to correct for. Root cause write-up is in `DEPLOY.stage.md`.

### Smoke test

The console loads (no gate — admin has none), Privy login works, and a non-admin account is refused
by the backend on every panel.

## Notes

- Env mirrors the shared tier convention: `NEXT_PUBLIC_APP_ENV` selects the prefix
  (`src/services/envConfig.ts` — the one place this app reads env). `yarn check:env` asserts the
  tier block stays identical to web's and landing's.
- Tailwind here, inline styles on web — deliberate. This is a dense desktop table UI on the same
  terracotta tokens, not the phone column.
- Every mutating panel writes an `admin_actions` row; the Audit page is that table.
