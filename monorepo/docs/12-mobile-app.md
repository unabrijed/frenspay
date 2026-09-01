# 12 · The mobile app

## What it is

The same product as the web app, on a phone: `apps/mobile` is an **Expo / React Native** app that
renders **`@fpay/app`** — the store, the backend client, the sheets and the product components the
web app renders — over **`@fpay/ui`**'s native renderer. It was revived on 2026-08-22 after being
parked; the revival's whole design is that there is **one product codebase** and two renderers,
so the drift that parked it the first time (a copy of the web's logic aging in place) cannot
recur. Android first; iOS compiles but is not a target yet.

What is the phone's own: expo-router **routes** (one per web page), the native **Platform** seam
implementation, the **Privy Expo bridge**, the **envConfig** (the web's tier block under
`EXPO_PUBLIC_`), **push** registration, and the `.native` twins of the few leaves that are a
different element per platform (camera, QR, text field, the mark, the flag).

## Flow — how a screen gets to the phone

```mermaid
flowchart LR
  T[packages/shared<br/>tokens · contracts · money] --> U[packages/ui<br/>primitives · theme · icons]
  U --> A[packages/app<br/>store · api · sheets · components]
  A --> W[apps/web<br/>routes · Privy web SDK · platform.ts]
  A --> M[apps/mobile<br/>routes · Privy Expo SDK · platform.ts]
  U -. rn.native · theme.native<br/>icons.native · leaf.native .-> M
  A -. SheetHost.native · Scanner.native<br/>QrCode.native .-> M
```

Metro resolves every `*.native.tsx` twin automatically; Next never sees them. Shared components
are written once against the web-typed style (`St` = `CSSProperties`); the native `sx()` strips
the browser-only keys on the way into RN, and the native theme is *typed* as CSS so the shared
code typechecks once (`tsconfig` `moduleSuffixes: ['.native', '']` on mobile). Native code
imports the **barrels** (`@fpay/ui`, `@fpay/app`) — Metro has package exports off for `@fpay/*`
so the barrel's relative imports get platform resolution.

**Boot:** `app/_layout.tsx` calls `configure(nativePlatform)` at module top — before any render —
which hands `@fpay/app` its storage (AsyncStorage), env, and the rest of the seam, then hydrates
the store (created with hydration skipped for exactly this reason). Fonts load, the splash hides,
`PrivyRoot` mounts lazily when an app id is configured, and the overlay layers (sheets, toasts,
the suspended gate, the live poller) mount once.

**The seam** (`packages/app/src/platform.ts`, ~15 members): `env`, `storage`, `session` (the KYC
stash — in-memory on the phone, it never leaves the process), `origin`/`returnUrl`, `openKyc`
(`expo-web-browser` auth session returning to `fpay://home`), `openMail`, `share`, `copy`,
`locale`, `onForeground` (AppState), `trace`, `pickContact` (the system picker — one contact,
nothing synced), `capabilities`.

**Auth:** `services/privy/PrivyBridge.tsx` publishes the same shape as the web bridge —
`setAuthBridge`, `setAuthReady` (bounded), `setRecoveryStatus`, then two clocks: sign-in on the
token (refresher, the revoked/suspended/deleted handlers, `onSignedIn()`, `load()`) and the wallet
on its own (`PrivySigner`, `walletAddress`, bounded by a 15 s `wallet_not_ready`) — so the store
cannot tell which SDK is underneath ([18](18-sessions-and-boot.md)). Signing goes through the embedded Solana wallet's
`provider.request({ method: 'signAndSendTransaction' })` against the RPC the env names.

**KYC:** the store opens Persona's hosted flow in an in-app browser with `fpay://home` as the
return; when the session ends (redirect or Done) the store polls `/me` until the tier lands.

**Push:** every in-app notification already passes through one backend call, `notify()`; it now
also fans out to the phone through Expo's push service ([10](10-ops-and-roadmap.md) for the ops).
The phone registers its token after sign-in + provisioning and unregisters before sign-out.

## Why this way

- **Share via packages, not copy.** The June port copied the store into web "with tiny shims" and
  the two drifted apart in two weeks — which is why mobile was parked. Lifting the product into
  `@fpay/app` costs one seam and a handful of `.native` twins; it buys one brain forever.
- **No navigation seam.** Sheets are store-driven; only routes navigate, and expo-router's
  `useRouter` has the same `push/replace/back` as Next's. Routes stay per app; `BottomNav` takes
  its router as props.
- **`St` stays the web type on both renderers.** The alternative — every shared style object
  forked into `ViewStyle` twins — is the drift problem again, one file at a time.
- **Android first, no EAS, no paid services.** A dev build over wireless adb; Expo Go cannot run
  Privy's native modules.
- **MaterialIcons (filled) for the icon twin**, not the Material Symbols Outlined font the web
  uses — `@expo/vector-icons` is bundled, the 24 glyph names all exist, and it is zero
  font-subsetting work. Revisit if it grates.

## Legalities

Nothing new: the phone talks to the same backend with the same limits, KYC gates and screening.
The contact picker returns one contact the user chose; no address book is read or uploaded
([04](04-p2p-and-contacts.md)). Push payloads carry a title, a body and a `kind` — no amounts
beyond what the inbox already shows, no identifiers.

## Status

- ✅ Workspace, deps, prebuild; `yarn typecheck` covers the app; `expo export --platform android`
  bundles the whole graph through the native twins (the real test of Metro resolution).
- ✅ P2P core, scan-and-pay (expo-camera), identity (Persona in-app browser, own-OTP pay-by-phone,
  pickers, inbox, invites), push (backend + registration), contacts picker — all typecheck-clean.
- 🟡 **Not yet run on a device.** The first device pass is Bridge's (`yarn workspace @fpay/mobile
  android` over wireless adb). Known first-run questions: RN 0.85's `boxShadow` string on Android,
  `Intl.DisplayNames` on Hermes (guarded — ISO codes if absent), Persona accepting an `fpay://`
  redirect-uri (the poll covers either answer), reanimated 4.3 with RN 0.85.
- 🟡 Passkey *link* on the phone needs `/.well-known/assetlinks.json` on frenspay.xyz naming the
  app's signing certificate; until then the Recovery sheet's link throws and shows status only.
- ⬜ Push delivery is gated on a free Expo project id (`app.json` `extra.eas.projectId`) and the
  FCM V1 key uploaded to it; without them registration quietly no-ops.
- ⬜ SDK 57: expo-doctor flags a Hermes V1 memory regression in SDK 56 (fix is in 57). Not a v1
  blocker for a dev build; upgrade is `npx expo install expo@^57 --fix` when Privy confirms 57.
- ⬜ Deliberately cut: sheet drag-to-dismiss, sheet/toast animations beyond the Animated rise,
  Material Symbols Outlined parity, address-book sync, EVM deposits on mobile (hidden on mainnet
  anyway), iOS device, EAS.

## Key files

- `packages/app/src/platform.ts` (the seam) · `configure.ts` (boot) · `sheets/registry.tsx` (the
  one sheet switch) · `components/{SheetHost,Scanner,QrCode}.native.tsx`
- `packages/ui/src/{rn,theme,icons,Screen,leaf}.native.tsx` · `leaf.types.ts`
- `apps/mobile/src/app/**` (routes) · `platform.ts` · `push.ts` · `services/envConfig.ts` ·
  `services/privy/{PrivyRoot,PrivyBridge,signer}.tsx` · `metro.config.js` · `app.json`
- Backend push: `db/migrations/0021_push_tokens.sql` · `services/push.ts` · `services/notify.ts` ·
  `routes/notifications.ts` (`/me/push-token`)
- Gates: `scripts/check-env.mjs` (mobile's tier block) · `scripts/check-copy.mjs`
  (`packages/app/src`) · `scripts/vercel-ignore.mjs` (`packages/app` wakes web only)
