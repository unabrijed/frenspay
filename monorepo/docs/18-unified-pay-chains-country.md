# Unified pay: QR / address / user ID / phone (country-default), more chains, chain-surface rule

**Status:** DRAFT — exploration in progress

## Context

Bridge's scope (2026-07-22):
1. Pay anyone directly via **QR scan, wallet address, unique user ID (@handle), or phone number** — one unified flow.
2. **Phone is the priority**: a number typed WITHOUT +country-code must default to the **sender's own country** dialing code (India model — pay someone by just their 10-digit number). Today's heuristic (borrow prefixes from the sender's enrolled phone) only works post-enrollment; it needs a real country default.
3. **Add more chains** to the supported list (still USDC-only, still Solana-execute).
4. **Chain-surface rule (product law)**: chain/network names appear ONLY when the user on-ramps, off-ramps, or sends to an external wallet address. Everywhere else fpay looks like a normal money app.

## Current state (facts already established)

- Chains: `packages/shared/src/chains.ts` — Solana `live` (all money movement, devnet SPL-USDC); ethereum/base/arbitrum/polygon/monad `coming_soon` (classified + refused server-side with `unsupported_network`). Classifier: base58→32 bytes = Solana; `0x`+40hex = EVM family (must ask user which chain).
- Directory (docs/17, shipped): handle canonical + immutable; opt-in `users.phone` (E.164, unique partial index); `/users/resolve?handle=|phone=`; `phoneCandidates(raw, ownPhone)` in `packages/shared/src/phones.ts` guesses ≤3 country codes from the sender's own number.
- No `users.country` anywhere. Didit KYC decision poll (`services/kyc/didit.ts:72-75`) reads ONLY `status` — the decision payload carries document country but we drop it.
- Web search flow (`friends.tsx` PeopleSearch): name / @handle / phone / address all resolve already; QR `pay:@handle` scans already pay.

## Research

- **Native USDC (mid-2026): ~34 chains.** CCTP V2 — the planned v2 execution rail (burn on Solana → mint on destination) — is live on 17 chains incl. Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Solana, HyperEVM, Unichain, World Chain, Linea, Sonic; **Monad has native USDC**; Aptos + Sui CCTP expected mid-2026. Sources: [Circle multichain USDC](https://www.circle.com/multi-chain-usdc), [CCTP V2 coverage](https://eco.com/support/en/articles/11813797-circle-cctp-v2-native-usdc-across-13-chains), [supported-chains explainer](https://www.bitget.com/wiki/circle-usdc-supported-blockchains-list).
- **Chain-list principle:** a chain belongs in `SUPPORTED_NETWORKS` iff native USDC exists there AND CCTP can eventually move it (v2 feasibility). EVM additions are free (same `0x` classifier). Sui/Aptos would need a new classifier branch (0x + 64 hex) — defer until their CCTP lands.
- **Phone country default feasibility:** an ISO-3166 → dialing-code static table (~245 entries, few KB, dependency-free — fits the shared-package zero-deps rule) fully replaces guessing: strip trunk `0`, prepend the sender's country code → exactly one candidate. libphonenumber still unnecessary (we never need to *validate* foreign numbers — a wrong normalization is a directory miss, never a mis-pay, because the verified-name confirm gates money).
- **Country source priority (all best-effort, later sources overwrite earlier):**
  1. Device locale region at signup (`navigator.language` → `en-IN` → `IN`) — zero friction, sent with `/auth/sync`.
  2. Phone country code when the user enrolls pay-by-phone (it IS a dialing code — authoritative for this purpose).
  3. KYC document country when verified (extend Didit `pollDecision` to extract it).
  4. Settings override row (user-visible truth).

## Exploration (verified)

- **Chain-surface audit: NO violations.** Rendered chain words exist only in the external-send flow (`sendAddress.tsx:94-128`, `friends.tsx:354-357`, store errors `usePayStore.ts:438,486`) — allowed context (a). On-ramp (`AddMoney.tsx:55-75`) shows a truncated raw Solana address with **no chain label at all** — risky the other way: a user could send USDC on another chain to it (lost funds). Borderline: onboarding copy "Creating your secure wallet…" (`faceid/page.tsx:60`) — only crypto-adjacent word outside the three contexts.
- **QR flow today** (`qr.ts:7-12` → `handleScan` `usePayStore.ts:402-433`): `handle` → resolve → sendAmount; `upi` → merchant pay; `address` → external send (solana amount / evm network sheet); `unsupported`/`unknown` → friendly error. **No `tel:`/bare-phone QR handling** — the one gap for "pay via QR by phone".
- **Off-ramp doesn't exist**: order flow is spend-only (`direction:'spend'`, `usePayStore.ts:666`); payout row `Quote.tsx:77` is the natural home for a future cash-out network/method picker. On-ramp picker home: `AddMoney.tsx:55-75`. `SendNetwork` (`sendAddress.tsx:113`) is the picker precedent.
- **Onboarding**: welcome → faceid (email OTP) → handle → fund → home. `navigator.language` read nowhere (only number formatting). Settings rows at `settings/page.tsx:44-48`.
- **phones.ts contract**: `phoneCandidates(raw, ownPhone?)` — `+` input → 1 strict candidate; local input → ≤3 own-phone-prefix guesses; carries the `ponytail:` upgrade note pointing exactly at this change (dialing-code table).

## Bridge's decisions (2026-07-22)

1. **Chains:** add the CCTP V2 EVM set — Optimism, Avalanche, Unichain, World Chain, Linea, Sonic, HyperEVM — to the existing six (all `coming_soon`; Solana stays the only `live`). Sui/Aptos when their CCTP ships (needs a 0x+64-hex classifier branch).
2. **Country:** silent auto-capture, no onboarding step — locale region at signup (set-if-empty) → phone CC on pay-by-phone enroll → KYC document country on verify (strongest) — plus a Settings "Country" override row.
3. **No-country fallback:** never guess a dialing code — prompt "use international format (+…)". No product-wide +91 default.

## Delta vs the "Country source" answer (flagged for approval here)

KYC document country is **dropped as a source** (was step 3 of the approved chain): a passport's issuing country is the worst *dialing* signal — expats are exactly the users whose document country diverges from their dialing country, and it would overwrite the verified-phone signal with a worse one. Also costs 3 KYC-file changes + an alpha-3 map for unverifiable Didit field names. Final chain: **locale (fill-if-null) → verified phone CC (overwrite) → manual Settings pick (overwrite)**. If compliance ever needs document country, it gets its own `kyc_country` column — an identity attribute, not a dialing preference.

# Implementation plan

## W1 — Chain list: CCTP V2 EVM set (`packages/shared/src/chains.ts`)

- `NetworkId` union + `SUPPORTED_NETWORKS` gain: `optimism` (Optimism), `avalanche` (Avalanche), `unichain` (Unichain), `worldchain` (World Chain), `linea` (Linea), `sonic` (Sonic), `hyperevm` (HyperEVM) — all `coming_soon`. Solana stays the only `live`. Zero classifier changes (all 0x-family). Comment records the principle: listed ⇔ native USDC + CCTP-V2-reachable; Sui/Aptos join when their CCTP ships (will need a 0x+64-hex classifier branch).
- `SendNetwork` sheet (`sendAddress.tsx:113-143`) renders from `SUPPORTED_NETWORKS` — auto-grows to 12 rows; make the list container scroll (`overflowY: auto`) if it doesn't already.
- Codify the **chain-surface rule** as the header comment in chains.ts: network names render ONLY in (a) external-address send, (b) on-ramp, (c) off-ramp.

## W2 — Dial-code table + country-aware candidates (`packages/shared`)

- **New `src/dialCodes.ts`** (~55 lines, pure data): `ISO_TO_DIAL` (all ~244 ITU allocations, hand-inlined), derived `DIAL_TO_ISO` with deterministic overrides for shared codes (+1→US, +7→RU, +44→GB, +39→IT, …), `isoFromE164()` longest-prefix (3→2→1 digits). Shared-code defaults are fine: the ISO label only affects display; the dial prefix is identical for every sharer and Settings can correct the label. Export from `src/index.ts`.
- **`src/phones.ts`**: `phoneCandidates(raw, opts?: { country?: string; ownPhone?: string })` — priority: explicit `+`/`00` → 1 strict candidate; `country` → 1 candidate (strip one trunk `0`, prepend dial code); else ≤3 own-phone-prefix guesses (today's behavior, unchanged fallback). Exactly one caller exists (`friends.tsx:290`, verified) — update it in the same commit, no back-compat overload. Italy kept-trunk-0 landlines mis-normalize → lookup miss only (aliases are SMS-verified mobiles); noted in comment.
- **Table-accuracy mitigation**: one-off cross-check of the inlined table against a reference list during implementation + spot asserts in the behavioral check (below).

## W3 — `users.country` plumbing

**Backend**
- `schema.sql`: `alter table users add column if not exists country text;` (+ write-strength comment). No do-block — matches the M7 single-ALTER precedent. `UserRow.country`.
- `upsertUserByPrivyDid` (`queries.ts`): accepts `country?`; insert gains the column; conflict branch `country = coalesce(users.country, excluded.country)` — **fill-if-null in SQL**, mirroring the display_name coalesce. New `setUserCountry(userId, iso)` (plain UPDATE).
- `routes/auth.ts`: `/auth/sync` validates optional body `country` (`/^[A-Za-z]{2}$/` → uppercase) and passes through; `/me` + sync response return `country?`. **New `POST /me/country`** (~8 lines: requireUserId, validate, UPDATE, return) — serves both the enrollment-derived write and the Settings pick. Client-asserted by design: country only tunes the caller's own candidate guessing — a lie = their own lookup misses; resolve stays strict E.164; money paths untouched. **No backend dial table.**
- Rate limit: add `POST /me/country` to the `auth` bucket rules (`rateLimit.ts`).

**Shared contracts**: `AuthSyncRequest.country?`, `MeResponse.country?`.

**Web**
- `api.ts`: `setCountry()`.
- `usePayStore.ts`: `country: ''` state (NOT persisted — matches `phone`; `load()` sets from `me.country`, `logout()` clears); `authSync` sends `new Intl.Locale(navigator.language).region` (try/catch; deliberately no `.maximize()` — a bare `en` must send nothing, not US); `setCountry` action (optimistic set + best-effort POST); after successful phone enroll (`startPhoneLink` dev branch + `confirmPhoneLink`): `isoFromE164(phone)` → `void setCountry(iso)`; `SheetId` += `'country'`.
- **New `components/sheets/Country.tsx`** (~45 lines, Currency.tsx pattern): SearchBar-filtered list of all countries via `Intl.DisplayNames` (zero deps), rows show name + `+code`, check on current, tap → `setCountry` + close. Register in `SheetHost` (+`TALL`).
- `settings/page.tsx`: `Country` row (`v={country || 'Not set'}`).
- `friends.tsx`: select `country` from store; call `phoneCandidates(query, { country, ownPhone })`. Empty-state copy unchanged (no-country + no-phone → "use international format" — Bridge's no-guess rule).

## W4 — Pay-by-phone via QR (`qr.ts` + `handleScan`)

- `ScanResult` += `{ kind: 'phone'; number: string }`.
- `tel:` scheme block (RFC 3966: strip `;params` + visual separators, accept `/^\+?\d{6,15}$/`) after the `ethereum:` block; bare-digits `looksLikePhone(raw)` as step 8, AFTER classifyAddress and before `unknown` — ordering safe by construction (handles/VPAs contain `@`; addresses are ≥32 chars vs 15-digit E.164 ceiling).
- `handleScan` phone branch (between `address` and `unsupported`): candidates from `{ country, ownPhone }` → own-number check ("That's your own number") → try `wallet.resolvePhone?.()` in order → found → `setFriend` + `open('sendAmount')` (verified-name confirm included for free); miss → "That number isn't on fpay yet".

## W5 — Chain-surface completion (small)

- `AddMoney.tsx` deposit row: label the address with its network — "Solana · only send on this network" (allowed context (b); today's unlabeled address invites wrong-chain deposits = lost funds).
- `onboarding/faceid/page.tsx:60`: "Creating your secure wallet…" → "Setting up your account…" (last crypto-adjacent word outside the three contexts).
- No on/off-ramp network pickers yet — only one live chain, nothing to pick; placement noted for later (AddMoney block / future cash-out payout row `Quote.tsx:77`).

## Verification

- `yarn typecheck` (all 4 workspaces; shared changes additive, mobile untouched).
- `yarn workspace @fpay/backend db:init` twice → idempotent; `users.country` exists.
- Behavioral check (temp script, deleted after): `isoFromE164('+919876543210')='IN'`, `'+12025550123'='US'`, `'+74951234567'='RU'`; `phoneCandidates('098765 43210',{country:'IN'})=['+919876543210']`; `+`-input passthrough; every `ISO_TO_DIAL` value matches `/^[1-9]\d{0,2}$/`; `classifyAddress` unaffected by 10–15-digit strings.
- Runtime (Bridge, servers up): sync from an `en-IN` browser → `/me` returns `IN`; type `98765 43210` → single `+91` candidate resolves; scan a `tel:+91…` QR and a bare-number QR → send flow with verified name; Settings → Country → pick CA → local numbers now default `+1`; EVM address paste → network sheet shows 12 coming-soon rows and scrolls; AddMoney shows the Solana label; no chain words anywhere else.

## Risks

1. Hand-inlined dial table typos — mitigated by cross-check + asserts; worst case = one country's default wrong → lookup miss, self-correcting via Settings.
2. Two-request enrollment (`/me/phone` then `/me/country`) — second is fire-and-forget; failure leaves the locale guess. `ponytail:` fold server-side only if it ever bites.
3. Bare-`en` locales send no country → column stays NULL → exactly today's own-phone fallback; no regression.
4. HyperEVM/Sonic/Unichain names are niche — they only ever render in the coming-soon list (allowed context).
