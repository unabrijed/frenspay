# fpay — mobile

The same product as the web app, on a phone. **Expo SDK 56 / React Native**, rendering
**`@fpay/app`** (the store, the backend client, the sheets, the product components — the web app
renders the very same files) over **`@fpay/ui`**'s native renderer. Revived 2026-08-22; the shape
is written up in [docs/12](../../docs/12-mobile-app.md). Android first; iOS compiles.

## Run it (free — a local dev build, no EAS, no store accounts)

```bash
cp .env.example .env        # Privy app id + the NATIVE client id (Privy dashboard → App clients)
adb pair <ip>:<port>        # once — Android 11+ wireless debugging, pairing code on the phone
adb connect <ip>:<port>     # each session
yarn android                # from apps/mobile: prebuild (once) + Gradle + install + Metro
```

Privy's native modules rule out Expo Go, hence the dev build. After the first install,
`yarn start` (Metro only) is enough — or `yarn dev:mobile` from the repo root. Clean cache:
`yarn start -- -c`. The app talks to **stage** by default; a local backend is reached by leaving
`EXPO_PUBLIC_LOCAL_API_URL` blank (the Mac's LAN IP is read from Metro).

## What lives here

```
src/
  app/                    expo-router routes — one per web page (same names, same guards)
    _layout.tsx           configure(platform) · fonts · hydration gate · Stack · SheetHost/Toast/SuspendedGate/LiveSync
    index.tsx             entry router (lib/bootRoute) · (tabs)/ home + activity · onboarding/ · detail · settings · invites
  platform.ts             the phone's Platform: AsyncStorage, in-app browser for KYC, Share, clipboard, AppState, contacts picker
  push.ts                 Expo push token ↔ backend; a tapped notification opens the inbox
  services/envConfig.ts   the web's tier block under EXPO_PUBLIC_ (asserted by `yarn check:env`)
  services/privy/         PrivyRoot (gate), PrivyBridge (publishes what the web bridge does), signer
  components/Splash.tsx   the loading screen
  lib/fonts.ts            Spectral + JetBrains Mono — the only two faces
```

Everything else — sheets, store, API, the primitives — is in `packages/app` and `packages/ui`.
A file there with a `.native.tsx` twin is what Metro hands this app; import the **barrels**
(`@fpay/ui`, `@fpay/app`), never a subpath (see `metro.config.js`).

## Verification

- `yarn typecheck` (repo root) covers this app; `npx tsc --noEmit` here does the same.
- `npx expo-doctor` — green except the SDK-56 Hermes V1 memory-regression advisory (fix is SDK 57).
- `npx expo export --platform android` — the whole graph bundles through the native twins.
- The device pass is the open item: see the Status section of docs/12.
