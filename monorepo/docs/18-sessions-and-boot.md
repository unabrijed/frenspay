# 18 · Sessions and boot: why people were asked for an OTP again, and what a cold load waits for

**Decision (Bridge, 2026-09-01):** "logout is an issue, why it keeps logging out again and again?
pretty bad for the app users looking for OTP all the time… provider app, main app, other apps" +
"make api one main constant… adds the logged-in tokens on every call… make this a rule" + "on the
admin side switch modes" + "reduce splash screen time". Prism plan
`~/.claude/plans/logout-is-an-issue-humble-bear.md`. Nothing here was unpushed: every cause below
was live on stage; prod (`sacred`) additionally lacks [17](17-handle-and-email-identity.md)'s
adopt-or-ask, which turns cause 2 into a dead end there until `stage → sacred` merges.

## The four things that read as "logged out"

1. **The LP console signed the partner out on every cold return** — a real, deterministic bug.
   `useWallets()` was read without its `ready`, which lags `usePrivy().ready` by the wallet-proxy
   iframe. So `wallets` was `[]` for a beat, the bridge took that for "no wallet", `createWallet()`
   threw (there is one), and a blanket `.catch(() => onSignedOut())` rendered SignIn. The web
   bridge had fixed exactly this and said so in a comment. Now: gated on `walletsReady`, and a
   bridge failure is a toast, never a sign-out (`apps/lp/src/services/privy/PrivyBridge.tsx`).
2. **`no_account` destroyed the Privy session.** The revoked handler called `logout()` whenever the
   browser remembered an account (`onboarded` is persisted). After the one-Privy-app flip
   ([16](16-escrow-pool-and-the-shelved-program.md) era, 2026-08-31) every returning DID had no row,
   so: OTP → `/me` says `no_account` → session destroyed → welcome → **OTP again** → (now
   forgotten) → handle screen → its probe adopts by email. Every device paid one OTP too many.
   Now `forgetAccount()` clears what the browser remembers about the ACCOUNT and keeps the SESSION
   and the wallet address (the probe sends it; `/auth/sync` is 400 without one) — the same session
   goes straight to adoption (`packages/app/src/store.ts`).
3. **Sign-in waited for the wallet iframe, and a 5 s fallback then showed the welcome screen to a
   signed-in person.** Both bridges published `signedIn` at the end of one chain gated on
   `walletsReady`; the fallback published "ready" with `authStatus` still `'signedOut'`, and
   `bootRoute` reads that before the persisted `onboarded`. The welcome screens route back when
   the chain lands — a flash — but anyone who tapped "I already have an account" inside it got an
   OTP, and on a slow link the iframe regularly takes longer than 5 s. **The same wait was the
   splash.** See §The chain, split.
4. **Admin has no automatic sign-out** — only its two buttons. Its "No profile here" after the DID
   rotation is the one-time "sign into the app once" the copy already states; `/auth/sync` needs a
   wallet address and the console creates no wallet, so it does not self-adopt (deliberate).

Refuted on the way, with source: the invite/stage gate cookie (365 d, not it); Privy config (no
session-length prop exists; Expo persists to SecureStore by default); storage clearing (the SW
killer clears registrations + caches only); and "a backend 401 can destroy the Privy session" — the
SDK forces a logout only when the LOCALLY stored token fails validation (app-id mismatch), never on
our 401.

## The chain, split

`apps/web/src/services/privy/PrivyBridge.tsx` and the mobile twin now run two effects:

- **Sign in on the token** (`ready && user`): `getAccessToken()` — a local read while the token is
  fresh, one Privy refresh hop when it has expired, never the iframe — then the handlers,
  `onSignedIn()`, `load()`. `/me` and the balance load while the wallet settles. A `null` token
  (nothing left to refresh; Privy has dropped its local state) publishes nothing: the 5 s fallback
  publishes readiness and welcome is the right screen. `signedIn` with no token would land an
  onboarded user on a $0 Home that every call 401s from.
- **The wallet, on its own clock** (`… && walletsReady`): create for a new account (the same
  once-latch), else the `PrivySigner` and `walletAddress` — written unconditionally. **The bridge
  owns `walletAddress`**: the embedded wallet is the only address this client can sign for. `load()`
  fills it from `/me` only while empty (an early stand-in for Receive; equal for every healthy
  account, [16 §invariant 48](16-escrow-pool-and-the-shelved-program.md)). Two writers with no
  fixed order were the hazard; one owner and a placeholder are not.
- **Bounded**: a wallet that has not appeared 15 s after the session resolved sets
  `authError = 'wallet_not_ready'`. The handle screen — the one screen that needs the wallet, for
  `/auth/sync` — renders that with a reload (web) or "close and reopen" (phone) instead of a splash
  with no way out. Before the split that failure fell through to the welcome screen; after it,
  `signedIn` is already published, so without the bound it would have been a splash forever (web:
  the 8 s watchdog reloading every 10 s; phone: frozen — it has no watchdog).
- **Every send asks for the signer before preparing anything** (`services/real.ts`, `orders.ts`,
  the cross-chain path in the store): Home is reachable seconds before the wallet now, and a
  prepared-never-signed transfer would leave a pending row. `getActiveSigner()` throws the code
  `wallet_not_found`, which has copy; it used to throw a sentence that rendered as "Something went
  wrong".
- Untouched: `bootRoute`, `BootState` and its six call sites; the 5 s fallback (it now bounds the
  token read, and the phone has nothing else to fall back on).

What a returning user waits for now: Privy `ready` + one token read → skeleton Home; data at
`/me` + `/balance`. Before: iframe + `/me` + `/balance`, with a welcome flash if the iframe was
slow. Measure with `bootTrace` (`apps/web/src/lib/boot.ts`, dev only) on a cold "Slow 3G" load;
the iframe (`walletsReady`) is the line to watch.

## The API rule

The ask was ~85 % shipped: one `req()` per app already picked the base URL, attached the bearer,
refreshed once on 401 and retried, and threw `ApiError`; there were **four** raw `fetch(` sites in
every frontend put together — the three helpers (web re-exports `@fpay/app`'s) and the landing
page's public waitlist POST. "Loads with the user by default" is the store (`/me` on `load()`).
What changed:

- **The token on every call.** Each helper asks the registered Privy refresher for the token per
  request — both SDKs say to (`@privy-io/expo`: "not recommended to cache"); the cached copy is the
  fallback, the 401 retry still covers a token the *server* rejects. No new logout path: a refresh
  that fails over the network rejects, and the helper absorbs it.
- **Admin's bodyless DELETEs reached nothing.** Its helper set `content-type: application/json`
  unconditionally; Fastify parses a DELETE body whenever a content-type is present and answers an
  empty JSON body with 400 before any preHandler. Denylist remove and invite revoke had never run.
  Same rule as web/lp now, with the copied `check:api`.
- **`check:fetch`** (`scripts/check-fetch.mjs`, in `check:all`): every `fetch(` under a frontend's
  `src` is in one of the four files, or the check names the stray. **`check:boot`** is wired into
  `check:all` — it was red and never ran (it asserted the funding step, gone with the testnet).
- Not built: a shared request core (`@fpay/shared` is `import type`-only for the backend, admin has
  no `@fpay/app`; three ~50-line helpers with a 12-line copied check is cheaper), a `useApi()` hook.

## The admin switch

Already built (`apps/admin/src/services/apiMode.ts`, `EnvSwitch.tsx`, the red rail on prod). One
Privy app on every tier ([16](16-escrow-pool-and-the-shelved-program.md) §One Privy app) makes one
session valid against both backends, so the switch is purely the base URL. What makes prod
selectable is configuration, all of it already in `DEPLOY.md` §Admin / `DEPLOY.stage.md` §CORS:
`NEXT_PUBLIC_API_URL` on the one admin project, the admin origin in prod's bare `CORS_ORIGIN`,
`ADMIN_EMAILS` on prod, and one sign-in to the app on prod so the row exists.

## Splash, the rest

- **Mobile**: `PrivyRoot` sat inside the same null-render gate as the fonts, so Privy's init
  (SecureStore, network) queued behind seven faces. It mounts on `hydrated` alone now; hydration
  stays in front because the persist merge would clobber a bridge write to a persisted key.
- **LP**: `/me` and `/balance` in flight together.
- **Cut**: making the Material Symbols stylesheet async (the one render-blocking remote resource) —
  `document.fonts.load()` then finds no FontFace and the icon visibility gate never opens; every
  icon hidden. Cut: a timeout on `/me` — a slow backend only holds a NEW-device user, and a timeout
  would send them to the handle screen against the same slow backend.

## Verification

`yarn check:all` (now including `check:api:admin`, `check:boot`, `check:fetch`); `tsc` in app,
web, mobile, lp, admin. `check-fetch` was shown to fail on a planted stray. On stage (Bridge):
LP — sign in, close the tab, reopen cold, three times: dashboard, no SignIn. Web — set a test
row's `users.privy_did` to junk, open the app: one OTP, a probe splash, Home; never a second OTP,
never a handle field. Web cold load on "Slow 3G": Home skeletons before the `walletsReady` trace,
no welcome flash. Admin — remove a denylist row, revoke an invite: 200. Phone — kill and reopen:
Home without an OTP.

## Open

Which tier the loops were reported on (prod needs the merge first); Home is reachable a few
seconds before the wallet — a Send in that window says "wallet is still being set up"; the 15 s
wallet bound and its reload are specified, not yet seen on a device; a `curl -X DELETE` against
stage confirms the Fastify reasoning.
