# 22 · Indonesia corridor (QRIS/IDR) + Asia expansion research

Status: IMPLEMENTED (sim + Xendit test-mode seam) — 2026-08-10.
Source: prism-plan run (3 research lenses + grounding pass + 3-skeptic adversarial verify, 2×Opus+1×Sonnet). Full deliberation lives in the plan archive; this doc keeps what the repo needs.

## The one-line decision

Indonesia shipped as a **currency-generalization keyed off the rails registry** — not a country feature. The rail is the currency authority (never `users.country`, never a QR's own claim); everything else followed from that.

## What was built (this change)

1. **Per-currency FX** — `services/fxRate.ts`: per-currency cache slots, plausibility bands (`INR [50,150]`, `IDR [12000,25000]`), per-currency fallbacks (`envConfig.fxFallbackRates`); one daily-updating free source serves all corridors. `envConfig.num()` now warns when it discards an explicitly-set out-of-range value. `/fx/rate?currency=` is authed (the source's ToS forbids public re-export of rate data).
2. **Per-currency fiat decimals** — `fiatDecimals(ccy)` lookup (INR 2, IDR 0) replaced the `INR_DECIMALS` constant in both `units.ts` mirrors. DB storage stays `numeric(20,2)` for every corridor; decimals govern trust-boundary validation, fee rounding, display.
3. **`quotes.currency`** (migration 0004, default `'INR'` = the backfill) threaded through `Quote`/`MerchantOrder` DTOs and every order read. `PayoutMethod` gained `'QRIS'` + a runtime `PAYOUT_METHODS` const; the backend mirror (`lib/rails.ts` `RAIL_CURRENCY`) is drift-checked by check-rails.
4. **Dust guard** — `/orders/quote` enforces `MIN_ORDER_USD = 1` (mirrors `MIN_EXTERNAL_SEND_USD`). This closed a live INR hole (0.01 INR quoted to a real 0.000105-USDC escrow order), found by the skeptic pass.
5. **QRIS parsing** — `emvqr.ts`: `'360'→IDR` + the Bank Indonesia national template (root tag 51, GUI `ID.CO.QRIS.WWW`/`ID.OR.GPNQR.WWW`, sub-tag 01 = 15-char PTEN NMID). `payTarget` gained `kind:'qris'`; the fail-open "`!t.currency` → treat as INR" became "undeclared → the RAIL's currency; declared mismatch → never prefill" (kills a latent ~200× keypad-seed bug).
6. **USD-denominated fees** — `FLAT_FEE_USD 0.45 / NETWORK_FEE_USD 0.09` converted per-corridor at quote time (₹40/₹8 were rupee literals; reused as-is they'd have been a $0.003 fee in IDR).
7. **Corridor live in sim** — `qris` rail `live:true`, two seeded QRIS LPs, currency-aware pay/quote/tracking/merchant surfaces (`fiatRaw`/`fiatFromUsd`/`fiatSymbol` in shared money.ts — ₹ en-IN with paise, Rp id-ID whole-rupiah), per-currency keypad caps (INR 6 whole digits, IDR 8), "Active in …" hero derived from the registry.
8. **Payout-provider seam** — `services/payout/` cloned from the `services/bridge` pattern: interface + config-selected registry; `providers/xendit.ts` (test mode only, key-gated, inert by default). An LP with `sim_behavior='psp'` has its fiat leg driven by the provider and completes through the **same `claimOrderPayout` CAS** a human merchant uses; `/webhooks/xendit` is the fast hint, the worker poll is authoritative (the Helius/Didit contract).

Not in this change: IDR as a *display preference* (home-balance in Rp; drags P2P/RateLock product decisions), `Txn.currency` for history rows, mobile (parked, carries its own INR debt), any real/live payout, the `amount_inr` column rename.

## Research findings that should outlive this change

### Providers & costs (verified 2026-08-10, sources in the prism archive)
- **Didit KYC**: free tier = 500/mo *per feature* (ID verification, liveness, face match, device/IP); covers Indonesian KTP-el/SIM/KITAS. **$0 for the sim/devnet phase.** Defensible production KYC adds NFC e-Passport ($0.15), Dukcapil registry match ($0.16), AML ($0.20) → ~$0.31–0.51/user. **Country eligibility lives in the dashboard-side workflow (`DIDIT_WORKFLOW_ID`), not in code — verify a KTP passes before announcing Indonesia** (docs/15 runbook).
- **Xendit**: test mode free before any KYB, preloaded IDR 1B virtual balance; payouts (beta-labeled API) across ID+PH+MY+TH+VN on one code integration — but **each country live = its own dashboard account + local legal entity + KYB dossier; no individual businesses**. Config in the codebase; company formation in the business.
- **FX source** (`open.er-api.com`): 164 currencies, updates once/day, IP rate-limited. Attribution is a docs-page request (now in Settings); the binding ToS clause is "no programmatic re-export" — hence the authed `/fx/rate`.

### Regulatory (Indonesia)
BI prohibits crypto as a means of payment; OJK supervises crypto-assets since Jan 2025 (POJK 27/2024). USDC stays back-office; the user-facing contract is IDR→IDR. Real-phase paths: **rent a PJP-licensed partner** (practical default), the **PTD remittance license** track, or **BI Sandbox 2.0** (6+6-month pilot). PJP capital is tiered IDR 500m–15bn. None of this constrains devnet/test-mode. Unaddressed in docs/11: Indonesia's PDP data-protection law + this whole jurisdiction — docs/11 needs an Indonesia section before anything real.

### Next corridors, ranked (sim-phase ease · real-phase ease)
1. **Philippines** — easiest overall. Didit ✓, PayMongo instant sandbox keys (payins; its disbursement product exists but is KYB-gated), Xendit PH test balance. **Trap**: PHP (~61/USD) sits inside the old INR sanity band, so a wrong-currency FX bug yields a *plausible* number — the per-currency `parseRate` built here is the prerequisite.
2. **Malaysia** — low regulatory temperature; DuitNow already in the rails registry; sandbox coverage unverified.
3. **Thailand** — sim-phase fine (PromptPay already parses); the real phase faces the region's sharpest crypto-payment ban (SEC 5/2565).
4. **Vietnam** — sim fine; VND (~26k/USD) needs its own band; Law 71/2025 regime unsettled until 2026.
5. **Singapore — avoid.** MAS DTSP regime (from 30 Jun 2025) licenses SG-incorporated providers serving foreign users and "will generally not issue" licenses. Also: where the fpay entity incorporates matters for this trap — check before any SG touchpoint.

With Phase A landed, each neighbor ≈ rails-registry entry + EMV branch + FX band/fallback + fiat decimals + seeded LPs.

## Open items
- [ ] **Didit dashboard**: confirm the workflow accepts Indonesian documents (KTP test per docs/15). If rejected, per-country workflow selection becomes a small config-plumbing change.
- [ ] **Xendit payout API schema**: written to the documented v2 shape but unverified against a live sandbox call (payout-coverage docs 404'd during research). Verify on first run with a test key; the seam is inert until a key is set.
- [ ] **QRIS parser vs real QRs**: the tag-51/NMID layout is source-verified, but run a handful of real Indonesian QR photos through `parseEmvQr` before trusting it in front of users.
- [ ] docs/11: add Indonesia (BI/OJK/PJP/PDP) section.
- [ ] `poller.ts:31` writes `users.country` from the KYC document — contradicts docs/18's recorded decision ("KYC document country dropped as a source"). Pre-existing; Bridge to rule keep-or-remove.
- [ ] Deferred product calls: IDR display preference, `Txn.currency`, `amount_inr` rename, mobile unpark debt.

## Telemetry (prism)
- divergence: 0.78 (evidence 0.85, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=fable · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: FX-locks grounded · decimals grounded · currency-from-rail grounded · bridge-pattern-reuse grounded · dust-guard grounded · phone-no-work grounded · Didit-costs sourced · Xendit-terms cross-tier-survived · regulatory-posture sourced · PH-ranking cross-tier-survived · QRIS-TLV verified-at-source · Xendit-schema unverified
- fleet: 3 lenses + 3 skeptics (plan-mode constrained)

> Cross-tier verification reduces instance-/tier-level error correlation but not shared-lineage blind spots. Treat cross-tier survival as weaker evidence than grounding.

Skeptic-pass changelog: 9 draft framings fell — currency-from-QR → currency-from-rail · payout-abstraction-from-scratch → clone the bridge pattern · 0dp-fixes-dust → min-order guard (live INR bug) · phone-work-needed → none (`phones.ts` already strips trunk zeros, `ID:'62'` present) · silent-overcharge → mass-403-dominant (tier-2 cap catches > ~Rp 87k) · $0-KYC → $0 sim only · neighbors-become-config → config-in-code + entity-per-country · attribution-violation → the ToS re-export was the real issue · rent-a-PJP-only → PTD/BI-sandbox paths exist.
