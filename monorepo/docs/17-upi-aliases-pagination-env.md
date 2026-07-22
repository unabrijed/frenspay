# UPI-style aliases (username + phone) & three-tier env config

**Status:** FINAL — approved scope: v1 = username hardening + opt-in pay-by-phone + multi-chain guards + local/stage/prod env config.

## Context

Bridge's scope: send/receive directly via **username or phone number**, UPI-style, country-aware, with the database properly indexed for it; usernames unique; multi-chain preserved. Plus: three environments (local/stage/production) with separate databases, everything branching off NODE_ENV (functionally like Bridge's OMS config example).

**Bridge's decisions (2026-07-22):**
- Keep `@bridge` as the payment ID everywhere. `bridge@fpay` UPI-format IDs are **deferred** until fpay has its own universal cross-country resolver ("worker for tag"). Behaviorally mirror UPI apps: resolve alias → show verified payee name → pay.
- Pay-by-phone is **strict opt-in** (UPI mapper consent model): registering the number IS the consent; no separate flag.
- Local env without `LOCAL_DATABASE_URL`: **warn loudly and fall back to stage DB** (no hard fail).

## Research: how UPI resolves payments (design basis)

- UPI ID = `username@psp`, unique network-wide. Pay-by-phone runs through NPCI's central mapper: phone → default VPA → account. Mapper rules copied here: **opt-in with explicit consent**, **own verified number only**, **reverse lookup (ID→phone) blocked**.
- **Payee-name confirmation** before money moves — the anti-wrong-send core.
- Every UPI-like rail (PIX, PayNow, PromptPay, DuitNow) = alias directory in front of accounts; **phone is the universal alias**; E.164 embeds country → no country column needed.

Sources: [NPCI numeric mapper circular](https://www.npci.org.in/PDF/npci/upi/circular/2021/NPCI-UPI-OC-115-Rollout%20of-Numeric-UPI-ID-Mapper-to-enable-UPI-Number.pdf) · [World Bank proxy-identifier note](https://fastpayments.worldbank.org/sites/default/files/2021-10/Proxy_Identifiers_Final.pdf) · [PayU mapper API](https://docs.payu.in/reference/upi-number-mapper-api) · [Cleartax VPA](https://cleartax.in/s/vpa-virtual-payment-address) · [PIX](https://en.wikipedia.org/wiki/Pix_(payment_system)) · [PromptPay](https://en.wikipedia.org/wiki/PromptPay)

## Current state (verified by exploration)

- **Handle → address:** `/transfer/prepare` (`routes/index.ts:276-282`) → `findUserByHandle` (`queries.ts:54`, exact case-sensitive) → `getWalletForUser` (`queries.ts:101`, chain-blind `limit 1`). Addresses in `wallets` table (`schema.sql:26-32`, `chain default 'solana'`) — structurally multi-chain, single Solana row per user in practice.
- **users** (`schema.sql:6-24`): `handle` unique case-sensitive; **dead `email`/`phone` columns (never written)**; no country field anywhere.
- **No server-side handle validation** — `/auth/sync` (`routes/index.ts:160-179`) stores any non-empty string verbatim (clients send `'@'+name`). Onboarding preserves case; search lowercases → mixed-case handles unfindable.
- **Handle silently mutable + display_name bug:** upsert (`queries.ts:79-83`) `do update set handle = excluded.handle, display_name = excluded.display_name`, and `AuthSyncRequest` (`contracts.ts:122-125`) has no displayName → **every re-sync nulls display_name**. Freed handles re-claimable = misdirection risk.
- **Privy:** backend reads only the DID (`services/privy.ts:20-22`). `@privy-io/server-auth@1.32.5` installed; `getUser(did)` exposes `user.phone.number` (verified against typings). Web `@privy-io/react-auth@3.32.1` has headless `useLinkPhone` (`sendCode`/`linkWithCode`), same shape as existing `useLoginWithEmail` usage in `PrivyBridge.tsx:21,30-35`. Privy does the SMS OTP — zero OTP infra for us.
- **Confirmer gap:** `schema.sql:46-47` mandates chain filter; `getPendingSignatures` (`queries.ts:423`) polls ALL pending rows. First non-Solana row = permanent-pending zombie.
- **Lookup:** `GET /users/resolve?handle=` exact-match → `{name, handle}` only. Contact Picker (`lib/contacts.ts`) returns `{name, tel}` but `friends.tsx` discards `tel`.
- **QR parser collision (why bridge@fpay is deferred):** `qr.ts:14,82` routes any `x@y` string to merchant UPI pay.
- **Env:** backend `config.ts:21-24` — local/development/stage ALL read `STAGE_* || bare`; **local dev shares the stage Railway DB**. Web `services/env.ts` — Next.js forces NODE_ENV, so stage needs its own switch.
- Reusable: `denylist kind='handle'` + `screenHandle` (`compliance.ts:96`), rate-limit rules table (`rateLimit.ts:20`), `toFriend` mapper (`queries.ts:43`).

---

# Implementation plan

## W1 — Three-tier env config (backend + web)

**`apps/backend/src/config.ts`**
- `env(key)` becomes three-tier:
  - `local`/`development` → `LOCAL_<KEY> || STAGE_<KEY> || <KEY>` (LOCAL_ overrides what differs; fee-payer/Privy/Didit deliberately shared with stage via fallback)
  - `stage` → `STAGE_<KEY> || <KEY>` (unchanged) · `production` → `<KEY>` (unchanged)
- Export `isStage`, `isProduction` alongside existing `isLocal`/`isDevelopment` (the only sanctioned branch points). `isLocal` semantics unchanged (rate-limit dev-shim gate).
- Boot log: env name + which prefix `DATABASE_URL` resolved from (host only, never credentials) + **loud warning when NODE_ENV=local resolves a STAGE_ database** (Bridge's chosen behavior — warn, don't fail).
- dotenv: keep `import 'dotenv/config'`, add root-.env fallback (cwd `.env` → monorepo-root `.env`) so root-launched runs work.

**`apps/backend/.env`** — three sections: `LOCAL_*` (`LOCAL_DATABASE_URL=postgresql://localhost:5432/fpay`, `LOCAL_PGSSL=disable` — commented until Bridge sets up local postgres), `STAGE_*` (current values unchanged), production bare names (placeholder comments only; set on host, never committed).

**`apps/web/src/services/env.ts`** — add `NEXT_PUBLIC_APP_ENV` (`local`|`stage`|`production`; defaults: `local` under `next dev`, `production` in builds; stage deploy sets `stage`). Each var picks `NEXT_PUBLIC_LOCAL_* → NEXT_PUBLIC_STAGE_* → NEXT_PUBLIC_*` by tier, keeping static-literal references (Next inlines). Existing export names (`API_URL`, `IS_DEV`, …) unchanged.

| env | database | selected by |
|---|---|---|
| local | `LOCAL_DATABASE_URL` (warn → stage DB if unset) | `NODE_ENV=local` (backend), `next dev` (web) |
| stage | `STAGE_DATABASE_URL` (Railway, current) | `NODE_ENV=stage` / `NEXT_PUBLIC_APP_ENV=stage` |
| production | `DATABASE_URL` (future) | `NODE_ENV=production` |

Out of scope: mobile env, and OMS-specific config (Redis, storage adapters) fpay doesn't have.

## W2 — Schema migration (first code step; idempotent, matches existing do-block style)

**`apps/backend/src/db/schema.sql`** — append after existing do-block (~line 252):
```sql
-- UPI-style aliases: handle is the payment ID (canonical '@' + [a-z0-9_.]{3,30});
-- users.phone is the mapper entry — E.164, present iff the user opted into pay-by-phone.
do $$ begin
  update users set handle = '@' || handle where handle not like '@%';
  update users u set handle = lower(u.handle)
   where u.handle <> lower(u.handle)
     and not exists (select 1 from users v where v.id <> u.id and v.handle = lower(u.handle));
end $$;
create unique index if not exists uq_users_phone on users (phone) where phone is not null;
```
**No new columns** (dead `users.phone` revived; no `phone_discoverable` — enrollment IS consent; no country column — E.164 embeds it; no `lower(handle)` index — writes are canonicalized so the existing unique constraint suffices). Case-collision rows are skipped (expected 0; detect: `select lower(handle) from users group by 1 having count(*)>1`).

## W3 — Directory hardening (usernames = the payment ID)

**`apps/backend/src/db/queries.ts`**
- Backend-local validators (invariant: backend never runtime-imports from shared):
  - `canonicalHandle(raw)`: trim → strip leading `@` → lowercase → test `/^[a-z0-9_.]{3,30}$/` → return `'@'+body` or null. **Stored form keeps the `@`** (avoids touching every UI surface, seed data, QR `pay:` scheme, store self-scan check).
  - `normalizePhone(raw)`: strip `[\s().-]`, map leading `00`→`+`, test E.164 `/^\+[1-9]\d{6,14}$/` → normalized or null.
- `findUserByHandle` (`:54`) + `resolveHandleToFriend` (`:109`): canonicalize input first (`if (!h) return null`) — fixes prepare, `/requests`, `/users/resolve`, onboarding availability at the root.
- `upsertUserByPrivyDid` (`:79-83`): conflict clause becomes `do update set display_name = coalesce(excluded.display_name, users.display_name)` — **handle immutable** (matches onboarding's "can't be changed later"; freed-handle misdirection closed) **+ display_name-nulling bug fixed**.
- New: `findUserByPhone(phone)` → `toFriend`; `setUserPhone(userId, phone|null)`.

**`apps/backend/src/services/compliance.ts`** — `screenHandle` (`:96`) canonicalizes before denylist match (seed `'@sanctioned'` already canonical).

**`apps/backend/src/routes/index.ts`** — `/auth/sync`: 400 `invalid_handle` if not canonicalizable; denylisted → 409 `handle_taken` (indistinguishable from taken — no denylist probing); pass canonical to upsert. Existing 23505→409 unchanged.

**`apps/web/src/app/onboarding/handle/page.tsx`** — input cleaning mirrors server: lowercase + strip to `[a-z0-9_.]` (like `friends.tsx:245`); server stays authoritative.

## W4 — Multi-chain make-sure (two queries, nothing else)

- `getWalletForUser(userId, chain = 'solana')` (`queries.ts:101`): add `and chain = $2`. All 9 call sites compile unchanged via the default.
- `getPendingSignatures` (`queries.ts:423`): add `and chain = 'solana'` — the confirmer IS the Solana poller; closes the documented zombie gap. Escrow inserts get chain by column default; `expireStaleUnsignedTransfers` stays chain-blind on purpose (abandoned unsigned prepares expire on any rail).
- No EVM address capture until an EVM rail exists (dead data; `wallets` table is the ready seam).

## W5 — Phone alias backend (the mapper)

**`apps/backend/src/services/privy.ts`** — `getLinkedPhone(privyDid)`: `client().getUser(did)` → `user.phone?.number ?? null`. (`getUser(id)` carries an SDK rate-limit deprecation note — irrelevant at this scale; upgrade path = identity token.)

**`apps/backend/src/routes/index.ts`**
- **`GET /users/resolve`** extended: `?handle=` unchanged (unauthenticated — onboarding availability check predates the DB user); `?phone=` **requires auth** (`requireUserId` — binds rate limit to identity, kills anonymous scraping). Response always `{ user: Friend | null }`; invalid/missing/non-enrolled all identical nulls (enumeration-proof by construction). `Friend={name,handle,ini}` — **phone never returned** → reverse lookup structurally impossible.
- **`POST /me/phone`** (opt in): Privy mode → `getLinkedPhone` → `normalizePhone` → `setUserPhone`; errors `400 no_phone_linked`, `409 phone_taken` (23505). Dev shim (only `!privyConfigured() && config.isDevelopment`): accept `{phone}` body. Own-number-only is free — the number comes from the caller's own Privy account.
- **`DELETE /me/phone`** (opt out): `setUserPhone(userId, null)`.
- **`GET /me`** + sync response: add `phone` (own data; drives the Settings toggle).

**`apps/backend/src/services/rateLimit.ts`** — rules: `GET /users/resolve` bucket 30/min; `POST /me/phone` 10/min (caps Privy API calls).

## W6 — Shared package

- **`contracts.ts`**: `MeResponse.phone?: string`; `WalletProvider.resolvePhone?(phone): Promise<Friend|null>` (optional → mobile/mock untouched).
- **New `packages/shared/src/phones.ts`** (client-side; chains.ts precedent) + export from `index.ts`: `phoneCandidates(raw, ownPhone?)` — `+`-prefixed input → strict E.164 normalize (1 candidate); local-format input → derive candidate country codes from **the searcher's own registered phone** (1/2/3-digit prefixes, ≤3 candidates), exact-match lookup discards wrong ones. **No libphonenumber** — a wrong candidate is a lookup miss, never a mis-pay (verified-name confirm gates money). `ponytail:` comment marks the ceiling (static dialing-code table / libphonenumber-js-min if cross-country contacts matter).

## W7 — Web UX

- **`services/api.ts` + `services/real.ts`**: `resolvePhone`, `registerPhone`, `deregisterPhone` one-liners; `real.ts` implements optional `resolvePhone`.
- **`store/usePayStore.ts`**: `phone` state (from `me.phone`); `enablePayByPhone`/`disablePayByPhone`; `AuthBridge` gains `sendPhoneCode`/`linkPhoneCode`.
- **`services/privy/PrivyBridge.tsx`**: wire `useLinkPhone` (`sendCode`/`linkWithCode`) into the `setAuthBridge` block — Privy sends the SMS.
- **`components/sheets/friends.tsx`**: contact picker stops discarding `tel` (`setQuery(c.tel ?? c.name)`); `PeopleSearch` debounced effect: handle → existing resolve; else `phoneCandidates(query, ownPhone)` → try `wallet.resolvePhone` in order, first hit → existing resolved-row → `sendAmount` flow. Empty states: "That number isn't on fpay yet" / prompt for `+` format when no own phone.
- **`SendAmount`** (`friends.tsx:63-67`): show `{friend.name}` above the handle — the UPI verified-payee-name confirmation.
- **New `components/sheets/PayByPhone.tsx`**: one sheet, three states (enter number → SMS code → on/off). Register in `SheetId` + `SheetHost`. Copy stays de-crypto: "Friends can find you by phone number."
- **`app/settings/page.tsx`**: one row — "Pay by phone · On/Off".
- **No changes**: `Receive.tsx` (handle already IS the payment ID), `qr.ts`, tx building/submit (phone resolves to Friend → existing `toHandle` prepare path; server-authoritative flow untouched; rows stay `kind='send'`).

## W8 — Route restructure + pagination (Bridge, 2026-07-22 mid-implementation)

- Split 812-line `routes/index.ts` (35 endpoints) into domain plugins — `system, auth, money, orders, kyc, notifications, webhooks` — registered by a thin `routes/index.ts`. Handlers move verbatim; **no path changes** (renames deferred — would break web+mobile for zero behavior).
- Keyset pagination on `/transactions`, `/orders`, `/notifications`: `?cursor=&limit=` → `{..., nextCursor}`, cursor = `(created_at, id)` tuple; no cursor = first page (clients unaffected until they adopt it). Queries gain `and (created_at, id) < ($cursor_at, $cursor_id)` + `nextCursor` from the last row.

## Verification

`yarn typecheck` (all 4 workspaces; shared changes additive/optional → mobile passes untouched). `yarn workspace @fpay/backend db:init` twice → idempotent.

Runtime (dev shim): resolve `?handle=@Bridge`/`Bridge` → `@bridge` (was null); sync `'@Neha!'`→400, dup→409, denylisted→409, re-sync different handle → keeps original + display_name preserved; `POST /me/phone {phone:'+91 98765-43210'}`→`+919876543210`; resolve `?phone=` variants → same Friend; dup phone→409; DELETE → null again; unauthenticated `?phone=`→401; **send-by-phone e2e**: search "98765 43210" (own phone `+91…`) → candidate hits → verified name → send lands via existing prepare/submit (daily cap intact); 31st resolve/min→429; manual `chain='ethereum'` pending row → poller ignores it; second ethereum wallet row → balance/prepare still pick Solana. Env: `NODE_ENV=local` boot → warning names stage DB host; `NODE_ENV=stage` → unchanged behavior.

Runtime (Privy mode): email login → onboard → Settings → Pay by phone → SMS code → On → second account finds it by number. **Requires phone login method enabled in the Privy dashboard first.**

## Risks / notes for Bridge

1. **Privy SMS**: phone linking needs the SMS method enabled in the Privy dashboard; SMS costs sit on Privy's plan — confirm pricing before shipping the toggle (cost-conscious flag).
2. Handle now truly immutable — fat-fingered onboarding handle needs admin SQL. Follow-up (3 lines, out of scope): skip handle step in "Replay onboarding" when one exists.
3. Naive country-code candidates can miss cross-country local-format contacts (never mis-pay). Upgrade path marked in code.
4. Legacy mixed-case collisions skipped by migration (expected 0).
5. `bridge@fpay` deferred (Bridge: revisit when the universal cross-country tag resolver exists — then special-case the `@fpay` suffix in `qr.ts` before enabling).
