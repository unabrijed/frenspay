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

Configured in `apps/admin/.env.local` (see `.env.example`). With no such file the console renders
its shell, mounts no login at all, sends no credential, and every panel returns 401 — which looks
like a bug and is really an empty config.

**Privy** — the working path, and the same Privy app as web, no wallet involved. Setting
`NEXT_PUBLIC_STAGE_PRIVY_APP_ID` is what mounts Privy (`USE_PRIVY`) and renders the Sign in button.
Allow `http://localhost:3002` as an origin in the Privy dashboard. The **App Secret is
backend-only** — it lives in `apps/backend/.env`, never here.

The account you sign in with needs a users row and admin rights. The console **cannot create one**:
it never calls `/auth/sync` (only web does), so sign into web once with that address first. Put it
in the backend's `ADMIN_EMAILS` and it's a root admin from that first login — root admins skip the
invite gate precisely so this bootstrap works on a directory that already has members.

**Seeded admin user** (`NEXT_PUBLIC_LOCAL_DEV_USER_ID` → `x-dev-user-id`) is documented in
`.env.example` but is **inert unless the backend has no Privy configured** — `auth.ts` accepts the
header only when `!privyConfigured()`, and this repo's `.env` configures it. Don't reach for it
first; it looks like it should work and silently doesn't.

## Deploy

The step-by-step runbook — creating the project, the branch-pin script, DNS, the domain steps —
is [`DEPLOY.stage.md` §Frontends](../../DEPLOY.stage.md#frontends--vercel-stage-projects)
(prod: [`DEPLOY.md`](../../DEPLOY.md)). Everything *admin-specific* is below, in full, so this
README doesn't lie by omission.

### One Vercel project, two targets

Web, lp and landing each ship a stage twin and a prod twin, hard-wired at build time to one backend.
**Admin does not.** There is a single admin project, and which backend it drives is an *operator*
choice made in the sidebar at runtime.

| Vercel project | Production Branch | Root Directory | Domain |
| -------------- | ----------------- | -------------- | ------ |
| admin | `stage` | `monorepo/apps/admin` | admin.frenspay.xyz |

Why one and not two: `src/services/api.ts` has exactly one `fetch`, so pointing the console
elsewhere is a single expression — and the console never moves money client-side, so every action
is still gated by `requireAdmin` and audited server-side no matter which host it lands on. A second
project would double the deploys, domains and variable sets to re-express a choice the app can make
for itself.

`apps/admin/vercel.json`'s `ignoreCommand` builds only when `VERCEL_ENV=production`, which a project
sees only on its own Production Branch — so the project follows `stage` and nothing else. The same
gate skips documentation: editing this README deploys nothing (`scripts/vercel-ignore.mjs`, asserted
by `yarn check:deploy`).

> Moving the console to ship from `sacred` instead is a dashboard setting, not a code change.

### The stage / prod switch

`src/services/apiMode.ts` — the mode lives in `localStorage` and `req()` reads it per call.

- **Stage is the default, always.** A fresh browser, cleared site data, or an unreadable value all
  land on stage. Prod is an explicit, persisted opt-in.
- **Prod is unavailable until `NEXT_PUBLIC_API_URL` is set.** No host, no switch: the control does
  not render and the console can only reach stage. That is the state today — backend prod is unwired.
- **Entering prod asks; leaving it doesn't.** Only the dangerous direction is modal. Making both
  modal would train you to dismiss the dialog that matters.
- **Switching reloads the page.** Every panel holds its rows in `useState`; carrying them across a
  switch would show one environment's rows under the other's label and fire actions with ids the new
  backend has never seen. The reload also drops the cached Privy token so the incoming backend
  re-verifies from scratch.
- **Prod mode is loud** — the nav rail turns red and the active segment is a red PROD pill.

The trade this makes, stated plainly: a stage-only console *cannot* write to prod, and this one can.
What replaces that hard guarantee is the safe default, the confirm, and the persistent red. Every
write is still authorized and audited server-side; the risk is aiming a legitimate action at the
wrong environment, not performing an illegitimate one.

### Settings

- **Root Directory `monorepo/apps/admin`** (that's what makes Vercel read `apps/admin/vercel.json`),
  with *Include source files outside of the Root Directory* **ON** — install and build run
  `yarn workspace @fpay/admin …` at the workspace root above it. Web is the app that turns that
  toggle OFF; admin can't, and the consequence is the `noop.js` trap below.
- **Node.js Version 24**, **Skip deployment for unaffected projects: Enabled**.
- Never override install/build in the dashboard — they come from `vercel.json`.

### Variables

Admin reads **exactly five keys** (`src/services/envConfig.ts`) and ignores everything else — in
particular it never reads `NEXT_PUBLIC_LANDING_URL`, which the prod runbook lists for the frontends
collectively. The working copy of this list is `apps/admin/.env.deploy` (gitignored, paste-ready).

```bash
NEXT_PUBLIC_APP_ENV=stage
NEXT_PUBLIC_STAGE_API_URL=https://stage.api.frenspay.xyz   # the "stage" target
NEXT_PUBLIC_API_URL=https://api.frenspay.xyz               # the "prod" target — unset ⇒ no switch
NEXT_PUBLIC_STAGE_PRIVY_APP_ID=<privy app id>
NEXT_PUBLIC_STAGE_PRIVY_CLIENT_ID=<optional — see below>
```

**The two API hosts are targets, not tiers.** Both are inlined; `apiMode.ts` picks between them.
`APP_ENV=stage` still governs everything else — Privy and the dev shim resolve through the shared
tier chain, unchanged.

**One Privy app must serve both backends.** The browser holds a single session, and a token minted
for one Privy app will not verify against a backend configured with another (`services/privy.ts`
→ `verifyAuthToken`). If prod ever gets its own app, `Providers.tsx` needs a mode-keyed `appId` —
cheap, because the switch already reloads.

**Your account needs a row in both databases.** Privy DID is looked up per-database, so sign into
web once per environment; `Providers.tsx` already has copy for the in-between state ("no profile on
this environment yet"). Both `STAGE_ADMIN_EMAILS` and prod `ADMIN_EMAILS` must name you.

`NEXT_PUBLIC_*` is inlined at build time, so a variable change does nothing until the next deploy:
set variables **then** deploy.

**The client id is optional.** Privy dashboard → your app → Settings → Clients; the client id looks
like `client-…`, the app id is the `cm…` on the same screen. Leaving it unset is supported —
`Providers.tsx` passes `clientId={PRIVY_CLIENT_ID || undefined}` and Privy falls back to the app's
default client. It only matters when you want per-client config. What actually gates login is
adding the admin origin to the Privy app's **allowed origins**.

### Prerequisites — a green build proves nothing on its own

This app is backend reads end to end; it has no other data source.

- Whichever backend the switch points at must be up and its domain resolving. Prod is the Railway
  `production` environment behind `api.frenspay.xyz`, wired up only at mainnet time — which is
  exactly why `NEXT_PUBLIC_API_URL` stays unset until then rather than offering a dead target.
- The admin origin must be in **both** backends' CORS lists — `STAGE_CORS_ORIGIN` on stage and
  `CORS_ORIGIN` on prod. One console, one origin, two services that each have to allow it. A
  missing origin breaks every panel **silently**.
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
  tier block stays identical to web's and landing's. The one departure is `API_HOSTS`, which reads
  both hosts explicitly instead of through `pick()` — routed through the tier chain, a build with no
  `APP_ENV` would resolve the production tier and quietly make the *stage* target the prod host.
- Tailwind here, inline styles on web — deliberate. This is a dense desktop table UI on the same
  terracotta tokens, not the phone column.
- Every mutating panel writes an `admin_actions` row; the Audit page is that table.
