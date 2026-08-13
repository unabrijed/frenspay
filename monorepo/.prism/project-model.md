# prism · project model — fpay monorepo

Seeded 2026-08-10 by the Indonesia-corridor prism-plan run. Feed Architecture/Invariants/Danger
zones/Lessons into every fan-out agent; never violate a recorded invariant without flagging it.

## Architecture (concern → where it lives)

- **Money/decimals law**: decimal string at rest/wire · BigNumber mid-calculation · bigint at chain edge · `number` only at print — docs/01 §Money & decimals; `packages/shared/src/units.ts` (byte-identical mirror at `apps/backend/src/lib/units.ts`, enforced by `check:money`).
- **Rails/country registry**: `packages/shared/src/rails.ts` — the ONLY country list (docs/21 product law). EMV QR parsing `packages/shared/src/emvqr.ts`; classifier `packages/shared/src/payTarget.ts`.
- **FX**: `apps/backend/src/services/fxRate.ts` (per-currency bands/cache/fallbacks) + `envConfig.fxFallbackRates`; authed `GET /fx/rate?currency=`.
- **Quotes/orders**: `services/quoteEngine.ts` → `routes/orders.ts` (trust boundary: per-rail destination regex, `MIN_ORDER_USD`, KYC caps) → `db/queries.ts` → order worker `services/simMerchant.ts`.
- **Provider abstractions** (interface + config-selected registry + poller-authoritative advance + CAS): crosschain `services/bridge/{rail,registry,machine}.ts`; fiat payout `services/payout/provider.ts` (+ `providers/xendit.ts`, key-gated); KYC `services/kyc/provider.ts`.
- **Webhook contract**: webhook = fast hint, poller = authoritative (`routes/webhooks.ts`: helius, kyc, xendit).
- **Compliance**: `services/compliance.ts` — tiers are USD-denominated and country-blind (correct design; conversions must use the QUOTE's currency rate).

## Invariants (cite before violating)

1. Rails registry is the only country list; going live on a rail IS the multi-currency milestone (docs/21; rails.ts header).
2. Decimals are always a parameter — `fiatDecimals(ccy)`, never a baked constant (docs/01).
3. Rounding law: user owes → UP; fpay delivers → DOWN; protocol fee ceiling → UP (docs/06; units.ts divUp/divDown).
4. `units.ts` exists twice, byte-identical (check:money enforces).
5. Backend may only `import type` from @fpay/shared — runtime values are mirrored + drift-checked (VPA_RE, PAYOUT_METHODS/RAIL_CURRENCY, units.ts).
6. The RAIL is the currency authority — never `users.country` (docs/18: dialing/display preference only, "money paths untouched"), never a QR's own tag-53 claim (cross-check, reject prefill on mismatch, never default a currency).
7. DB fiat columns stay numeric(20,2) scale for every corridor; validation/display decimals live in code.
8. No real payout/on-ramp before real KYC/AML vendor + sanctions + counsel sign-off (docs/11). Payout providers are key-gated test mode only.
9. Payee-name confirmation is the anti-wrong-send gate; loose classification is tolerated because of it (docs/17).
10. check-scripts in `check:all` are no-DB, no-network (check-fx's live fetch is opt-in via FX_CHECK_LIVE=1).
11. A DB row is never sufficient to move money: payout-provider registry membership = credential resolves AND row enabled; admin flips can only subtract (disable/reorder); enabling a new money-mover requires a deploy; the sim adapter is excluded from the adapter map in production (docs/23).
12. Refund and failover require a RAW terminal provider status; the worker keeps polling while escalated; REVERSED freezes (orphan event + risk_event), never fails over; REJECTED is terminal-failed (docs/23).
13. `orders.payout_provider_id` is claimed (guarded CAS) BEFORE the first initiate and never silently reassigned; sticky orders keep polling a disabled row — disable affects selection only (docs/23).
14. Provider-model corridors settle through a platform-owned merchants row (`sim_behavior='psp'`, `user_id` NULL) — `merchant_id` stays NOT NULL on every order; platform rows are exempt from bond draws (docs/23).
15. Routing never crosses rails — rail is a hard filter, no fallback (docs/23; the old fallback leaked escrow cross-corridor).
16. `users.status` is enforced in `authPreHandler` (403 `account_suspended`, admins exempt — the console must stay reachable for recovery); user-suspend cascades one-way to the owned merchants row (routing/payouts never join users); `resolveHandleToFriend` filters suspended, `findUserByHandle` deliberately does NOT (docs/24).

## Danger zones

- `routes/orders.ts` destination regexes — the ONLY gate before a human/PSP acts on a scanned string.
- `payTarget.ts` amount-seeding — a wrong-currency prefill misprices by orders of magnitude (~200×). Any new rail must land its `NUMERIC_CURRENCY` entry + registry row BEFORE or WITH its parse branch.
- `envConfig.num()` silently falls back to defaults (now warns) — an out-of-range env value does NOT fail boot.
- FX sanity bands: a wrong-currency value can be IN-band and plausible (PHP ~61 vs INR ~95) — per-currency `parseRate` + the check-fx cross-currency asserts are the guard.
- `claimOrderPayout` is a CAS — all fiat-leg completion (human, PSP, webhook) must route through it.
- Compliance tier caps convert fiat→USD at the mid — a wrong rate turns the caps into mass 403s.

## Lessons

- Skeptic passes pay: 9 of the draft's framings fell under adversarial verify (see docs/22 changelog), including the architecture direction (currency-from-QR → currency-from-rail) and a live INR dust-order bug.
- `phones.ts` already handles trunk zeros + variable length — don't add phone deps.
- Xendit "one integration, five countries" = code only; each live country needs a local legal entity.
- Singapore (MAS DTSP) is a trap for this business shape; check entity domicile before SG anything.

## Decision log

- 2026-08-10 · **Indonesia corridor enabled** as currency-generalization keyed off the rails registry; sim LPs + key-gated Xendit test-mode payout seam; Philippines designated fast-follow; Singapore avoided → docs/22-indonesia-corridor-and-asia-research.md. Open questions tracked there (Didit workflow country config, Xendit schema verify-on-first-run, QRIS real-sample validation, docs/11 Indonesia section, poller.ts:31 vs docs/18).
- 2026-08-11 · **Per-corridor settlement models adopted** (`lp` vs `provider`; the choice is an entity/licensing commitment) with a DB payout-provider registry (rows = routing metadata; creds = env; priority+failover with raw-status discipline) and the platform-settlement-row mechanism — `merchant_id NULL` rejected under adversarial verify (4 subsystem breaks incl. deleted payer recourse) → docs/23-settlement-models-and-provider-registry.md. Open: float model (prefund vs vendor-converts), charge-the-flat-fee, per-model order floor, THB timing, REVERSED auto-resolution, cross-account idempotency scope (unverified). All work on `stage` branch (stage→stage env, sacred→prod).
- 2026-08-13 · **Admin user moderation shipped** (handle renames admin-ONLY — users still can't self-change; display-name edits; suspend/reinstate with mandatory reason) — freed handles release INSTANTLY, Bridge's explicit accepted risk ("you have to manage your username"). Suspension = one gate in authPreHandler (admins exempt) + resolve-time receive-block + one-way merchant cascade; audit note `@old -> @new; reason` is the sole post-release history disambiguator → docs/24-admin-user-moderation.md. Cut-but-mandatory-later: recipient pinning + request-payment binding to `from_user_id` BEFORE self-service handle changes ever ship. Open for retro: does support need read-only access for suspended users; request-pay staleness window.
