# Pay

A premium, iOS-style mobile payments app for inbound foreign travelers in India.
Hold a **US-dollar balance**, spend in **rupees** instantly by scanning any UPI QR
at a rate **locked the moment you pay**, plus send/request with friends. The balance
is backed by USDC, but no crypto language appears anywhere in the UI.

This is an **Expo / React Native (TypeScript)** implementation of the Claude Design
handoff in [`design-reference/`](./design-reference) — all 19 screens, built
pixel-accurately with the prototype's full interaction behavior on local/mock state.

## Run it (free — no paid accounts needed)

```bash
npm install
npx expo start
```

Then either:
- Press **`i`** / **`a`** to open the **iOS Simulator** (needs Xcode) or **Android
  emulator** (needs Android Studio). Expo CLI auto-installs the SDK-matched Expo Go, so
  this always works regardless of the stores.
- Scan the QR code with **Expo Go** on a physical phone — but see the note below first.

> **Physical phone on Expo Go: the store version may be too old.** This app is on **Expo
> SDK 56**. Expo ships the SDK-56 build of Expo Go to the App Store / Play Store on a lag,
> so a phone with the "latest" store Expo Go can fail with *"This project requires a newer
> version of Expo Go"* — and updating from the store won't help (nothing newer is there
> yet). On **Android**, sideload the matching build:
> `https://expo.dev/go?sdkVersion=56&platform=android&device=true` (allow "install unknown
> apps"; uninstall the store Expo Go first if the install is rejected). On **iOS**, use the
> Simulator, `eas go`, or a development build. Background:
> https://expo.dev/changelog/expo-go-and-app-store-may-2026

No EAS, no Apple Developer account, no Google Play account is required to develop
and test. Those only matter later, when you publish to a store.

First launch runs onboarding (Welcome → Face ID → handle → add first dollars). To
replay it, go to **Settings → Replay onboarding**. Persisted state lives in
AsyncStorage; clear the app's data (or reinstall in Expo Go) to reset.

## Architecture

```
src/
  app/                     # expo-router routes (file-based)
    _layout.tsx            #   root: font + state-hydration gate, StatusBar, Stack, SheetHost
    index.tsx              #   entry gate → onboarding (first run) or Home
    (tabs)/                #   Home + Activity, with a custom tab bar (lifted Pay button)
    onboarding/            #   Welcome · Face ID · Handle · Fund
    detail.tsx, settings.tsx  # full screens (slide from right)
  components/
    SheetHost.tsx          # store-driven bottom-sheet layer (all 12 sheets)
    sheets/                # Scan · Amount · Review · Success · Declined · Add · Send · …
    RateLock.tsx           # the signature element (3 variants; default Columns)
    TxRow.tsx, ResultBlock.tsx, BottomNav.tsx, icons.tsx
    ui/                    # Button, Keypad, Segmented, primitives, Txt, BackButton
  lib/
    theme.ts               # design tokens (colors, type scale, radii, shadows) ← pay.css
    money.ts               # RATE = 87.55, inr() / usd() / inrRaw()
    fonts.ts               # Schibsted Grotesk · Inter · Spline Sans Mono
  services/
    wallet.ts              # WalletProvider + SettlementProvider seam (mock impls today)
  store/
    usePayStore.ts         # single screen-state controller (zustand + AsyncStorage)
```

### The backend seam
The UI and store talk only to the `WalletProvider` / `SettlementProvider` interfaces
in `src/services/wallet.ts`, with the contract types shared from `@pay/shared` (the
"thin interface" from `backend-architecture.md`). Today these are in-memory mocks. In
**Phase 1**, the real providers (Privy embedded wallet + Solana USDC transfers via
Helius, the Railway Fastify API in `apps/backend`) drop in there with no UI changes.
**Phase 2** (INR merchant settlement via the licensed partner float) becomes the real
`SettlementProvider` — gated on the partner per the legal brief.

### Locked design decisions
Per the design chat: **INR-forward Home · Columns rate-lock card · emerald accent**.
The prototype's "Tweaks" panel (a design-comparison tool) is intentionally not shipped;
the Home INR/USD toggle is kept because it is a real product feature.

### Faithful adaptations (vs. the HTML prototype)
- The OS draws the status bar and device frame — we don't render the prototype's fake
  `9:41`/battery bar or the 390×844 phone shell. Screens fill the safe area.
- Bottom sheets dismiss via scrim/× (as in the prototype), so no gesture library is
  used; transitions use the platform-standard rise+fade / slide-X.

## Verification done
- `npx tsc --noEmit` — clean.
- `npx expo-doctor` — 21/21 checks pass.
- `npx expo export --platform ios` — full module graph bundles to Hermes bytecode.

Run `npx expo start` to walk the flows interactively.
