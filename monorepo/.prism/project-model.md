# prism · project model — fpay monorepo

Seeded 2026-08-10 by the Indonesia-corridor prism-plan run. Feed Architecture/Invariants/Danger
zones/Lessons into every fan-out agent; never violate a recorded invariant without flagging it.

> **Doc numbering (2026-08-25):** `docs/` was renumbered to 01–13 by commit `abdf036`. Older
> entries below cite the retired set; read them as: docs/11 (compliance) → `08-compliance-and-legalities`;
> docs/17–18 (pay-target / country) → `01-architecture` + `04-p2p-and-contacts`; docs/21 (rails law)
> → `01-architecture`; docs/22 (Indonesia plan) → `06-offramp-and-settlement`; docs/23 (settlement
> models) → `06-offramp-and-settlement`; docs/24 (moderation) → `07-admin-and-moderation`. The LP
> console is `11-lp-console`. Git history holds the originals.

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
   **EXCEPTION, accepted by Bridge 2026-08-29 (docs/14):** while the identity vendor is off
   (`config.personaLive` false — its credentials are blank), a partner is admitted on a human's
   reading of the KYB form rather than a vendor's identity check. **No tier is granted** — that half
   was removed the same day after the audit below; no payer limit moves and there is nothing to sweep.
9. Payee-name confirmation is the anti-wrong-send gate; loose classification is tolerated because of it (docs/17).
10. check-scripts in `check:all` are no-DB, no-network (check-fx's live fetch is opt-in via FX_CHECK_LIVE=1).
11. A DB row is never sufficient to move money: payout-provider registry membership = credential resolves AND row enabled; admin flips can only subtract (disable/reorder); enabling a new money-mover requires a deploy; the sim adapter is excluded from the adapter map in production (docs/23).
12. Refund and failover require a RAW terminal provider status; the worker keeps polling while escalated; REVERSED freezes (orphan event + risk_event), never fails over; REJECTED is terminal-failed (docs/23).
13. `orders.payout_provider_id` is claimed (guarded CAS) BEFORE the first initiate and never silently reassigned; sticky orders keep polling a disabled row — disable affects selection only (docs/23).
14. Provider-model corridors settle through a platform-owned merchants row (`sim_behavior='psp'`, `user_id` NULL) — `merchant_id` stays NOT NULL on every order; platform rows are exempt from bond draws (docs/23).
15. Routing never crosses rails — rail is a hard filter, no fallback (docs/23; the old fallback leaked escrow cross-corridor).
16. Routing's hard filters ALL live in `listRoutableMerchants`' SELECT (online, KYB, rail, country,
    bond ≥ MIN_BOND) — never in a periodic job. The bond floor was previously only in
    `recomputeMerchantStats` (every 10th tick, ~80s), so a zero-stake approved LP was routable in
    the gap. Platform `psp` rows are exempt from the bond floor AND from leverage, same reasoning as
    their dispute-draw exemption (docs/23; queries.ts `listRoutableMerchants`, routing.ts `availableOf`).
17. Effective float = `min(float_usdc, bond_usdc × LEVERAGE[tier])`. `float_usdc` is a self-declared
    claim and was never checked against the stake (merchantStats.ts `LEVERAGE`).
18. `orders.merchant_id` is the PROVISIONAL holder; the lock (`locked_at`) is a CAS that transfers
    it — invariant 14 (never NULL) survives the marketplace. An order is offered only while
    `locked_at is null and now() >= offer_widens_at`; provider/sim orders are **born locked** at
    `payment_detected`, which is what lets `claimOrderPayout` require `locked_at is not null` with
    one predicate and no psp special case (0015; orderMachine `onTransferConfirmed`).
19. The payee is redacted in SQL (`null::text as payout_destination` in `listOpenOffers`), never in
    a mapper. The offer pool is DERIVED per request, never stored — a stored offer list would be a
    stale snapshot of capacity, price and eligibility.
20. An order is only offered to LPs with `spread_bps <= quotes.spread_bps` (the price it was struck
    at). This is what makes broadcasting safe with per-LP pricing: any locker earns ≥ their own ask
    and the payer's quote is never repriced. Requires `quotes.spread_bps` (0015) — `rate` is
    display-only and post-fee, so the spread is unrecoverable from it.
21. The payer must never perceive that a person settles their payment: no LP-aware copy, no
    LP-aware wait state, no LP name on a payer DTO. Any LP-side race happens inside time the payer
    already spends (alert fires at `pay_instructions`, while they sign) — never in front of them.
22. `merchants.suspend_reason` distinguishes machine suspension ('bond') from human (admin
    moderation, user-suspend cascade — both write the same status through `setMerchantStatus`).
    Auto-reinstate may ONLY reverse 'bond', or it silently un-bans a moderated merchant.
23. `users.status` is enforced in `authPreHandler` (403 `account_suspended`, admins exempt — the console must stay reachable for recovery); user-suspend cascades one-way to the owned merchants row (routing/payouts never join users); `resolveHandleToFriend` filters suspended, `findUserByHandle` deliberately does NOT (docs/24).
24. **The tier is the price envelope** (2026-08-24): a human LP prices inside `[MIN_SPREAD_BPS, TIER_MAX_SPREAD_BPS[tier]]` (merchantStats.ts; enforced in `setSpread`), and `updateMerchantStats` clamps `spread_bps` with `least()` in the SAME statement the tier lands in — no window where a downgraded LP charges a price their tier no longer allows. Provider (`psp`) rows' `spread_bps` remains the platform's corridor take (docs/06).
25. **`settled` (the tier volume gate) is LIFETIME; the reputation RATES are 90-day** (merchantStats.ts `recomputeMerchantStats`). Windowing `settled` would make a rung earned by volume dissolve in a quiet quarter → leverage 8→3 → capacity cut under already-committed float (lock CAS reads leverage from the fresh tier, queries.ts `lockOrder`). `positive_rate` also stays lifetime — `feedback_up` has no timestamp of its own. Dispute bounds live INSIDE `filter(...)` on each table's own timestamp; a WHERE bound turns the left joins inner and drops zero-history merchants.
26. **The cooldown window is a bind param, one fragment, three attach points** (`payeePaidSql`: blocked set, lock CAS, pool view); `PAYEE_COOLDOWN_DAYS` (180 since 2026-08-24) is the only place the number lives. Raising it re-blocks pairs retroactively at deploy. `psp`/sim exemption exists ONLY in `blockedMerchantsForPayee` — lock and pool have no exemption predicate; psp rows are exempt by construction (born locked). Load-bearing, silent.
27. **A reroute must re-alert.** `rerouteOrder` grants a fresh `HEAD_START_MS` and now fires `alertMerchantOrderReady`; before 2026-08-25 the failover LP's head start ticked away against a 3s poller. The head start (5s) is real ONLY because the preferred LP is pushed in the same synchronous pass the clock starts and rivals are DB-blocked from seeing the order until it widens (`listOpenOffers` `offer_widens_at <= now()`).
28. `routeQuality` / `quotes.route_quality` is DEAD OUTPUT — computed (quoteEngine.ts), persisted, on the DTO, read by nothing in any app (verified 2026-08-24, 3 independent greps). Deletion candidate; do not build on it.

29. **Blank vendor credentials are a STATE, not an error.** `config.personaLive` (envConfig) is the
    one switch: provider is 'persona' AND both credentials pass `usableSecret`. `assertKycConfig` may
    only throw for a `persona_sandbox_` key on a production tier — anything else that throws at boot
    turns a variable edit into a crash-loop, which is exactly the bug docs/14 exists to have fixed.
    `KYC_PROVIDER=""` can never express "off": `env()` collapses empty to its fallback, `'persona'`.
    Asserted by `check-kyc-switch.ts` (a process per scenario — envConfig reads env once at load).
30. **Every KYB country spec carries exactly one required `identity: true` field** (kyb.ts;
    check-kyb enforces). While the vendor is off, approving that form IS the identity decision, so a
    spec with only business identifiers would make the approval a judgment about a business nobody
    was asked to identify. India: PAN. Indonesia: NIK — NIB and NPWP are both the business.
31. **Dev-only capabilities gate on `isLocal`, never `isDevelopment`** — and the gate belongs at the
    SELECTOR, not at each caller. `isDevelopment = isStage || isLocal`, and stage is mainnet. Three
    sites had this wrong on 2026-08-29 and each was one word: `/sim/kyc/:tier` (self-promote to tier
    3), `/kyc/verify`'s instant branch (self-promote to tier 2 whenever KYC_PROVIDER was 'sim'), and
    `auth.ts`'s `x-dev-user-id` shim (impersonate ANY user with no token, whenever the Privy vars were
    blank — and blanking a var is now a normal gesture here, per docs/14). Fixing the first and
    calling the class closed is what let the second survive: `getKycProvider()` now returns sim only
    when `isLocal`, so no present or future caller can reach it off-local. The correct alternative
    pattern already existed at `orders.ts` and `money.ts`: `isDevelopment && !isMainnet`.
32. **Every `kyc_tier` gate is PAYER-side.** money.ts (external unhosted sends), crosschain.ts (EVM
    withdrawal), compliance.ts (send + cash-out limits), and `/merchants/apply`. `merchantOps`,
    `routing` and `listRoutableMerchants` read `kyb_status` + `bond_usdc` + `status` and never a tier.
    So raising a partner's tier grants them nothing as a partner and everything as a payer — which is
    why the manual grant was deleted (docs/14). Check this before ever tying a tier to a partner
    action again.

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
- A spec that describes the architecture accurately can still be ~half already-shipped: the 2026-08-24 routing spec's lock/redaction/ceiling/reroute sections were DOCUMENTATION of existing code, not work. Verify "what's new" against the tree before sizing the patch.
- Windowing a count that feeds a threshold changes the threshold's meaning (settled → tier gate). Ask "who else reads this number" before bounding any aggregate.
- "≈ zero" latency arguments must trace WHO gets pushed vs who polls, and whether the clock and the push start in the same pass — the 5s head-start claim fell 3-0 on exactly that.
- A metric with no consumer (routeQuality) can still distort a plan if the plan assumes it matters; grep consumers before defending an output.
- **A reference someone links may already be IN the tree.** The p2p.me merchant form Bridge pointed at
  was ported months earlier as `kyb.ts` SCREENING, field for field, with a review queue. Grep the repo
  for the peer product's actual questions before sizing "build this form" as new work.
- **Ask what the chosen SCOPE deletes, before designing.** All three explorer lenses proposed a
  parallel manual-KYC subsystem. Scoping the fallback to LP applicants only collapsed the entire need:
  those users already fill in a form a human already reviews in a queue that already exists. The
  scoping answer arrived before the design and still nearly got designed around.
- Two changes landing in one handler (approve a business / grant a tier) need the audit row and the
  confirm dialog to name BOTH — or better, don't land two changes in one handler.
- **Audit the thing you just shipped, against the code, before it settles.** The manual-onboarding
  change was well-reasoned and its central mechanism was still wrong: it granted a tier that bought
  its recipient nothing. Six downstream problems existed only to support that one unnecessary write.
  Ask "what does this actually unlock, at every gate that reads it?" and enumerate them — the answer
  took one grep and overturned a decision two rounds of planning had agreed on.
- **A half-fixed bug class is more dangerous than an unfixed one**, because the commit message says it
  is closed. Locking `/sim/kyc/:tier` and declaring the sim-on-stage doctrine moot left the identical
  hole one route over, and the next reader had a written reason not to look.

## Counsel flags & open questions (from 2026-08-24 routing plan — for prism-retro)
- FLAG-1: the pair rule has TWO recorded rationales (LP bank-freeze protection, docs/06 §pair rule; payee data-minimisation, docs/06 §privacy). Under the second, lock→see VPA→unlock→re-lock is a harvesting path (unlock is penalty-free and writes no `lock_expired`). Counsel decides which governs; that decides whether A3 gets fixed.
- FLAG-2: a forced split is "one payment, ≤3 source accounts, one receiver, same day" — deliberately generated. Explainability question for counsel; per-leg cooldown holds in code.
- Unverified: is the compliance cash-out cap checked per PAYMENT or per LEG? If per-leg, splits multiply a payer's effective cap. Check before real-money scale.
- Open: real `TIER_MAX_SPREAD_BPS` values (placeholders 100/200/300 shipped); a feedback timestamp column (so `positive_rate` can window); check-lock has no CI story (invariant 10 keeps check:all no-DB); no distinct payer-facing error for `no_merchant` (bare 503); A2 coverage-DoS via min-size live orders; A7 lock churn writes no attempt rows so "max 3 attempts" is bounded only by `expires_at`.

## Decision log

- 2026-08-10 · **Indonesia corridor enabled** as currency-generalization keyed off the rails registry; sim LPs + key-gated Xendit test-mode payout seam; Philippines designated fast-follow; Singapore avoided. Open questions: Xendit schema verify-on-first-run, QRIS real-sample validation, docs/11 Indonesia section.
- 2026-08-11 · **Per-corridor settlement models adopted** (`lp` vs `provider`; the choice is an entity/licensing commitment) with a DB payout-provider registry (rows = routing metadata; creds = env; priority+failover with raw-status discipline) and the platform-settlement-row mechanism — `merchant_id NULL` rejected under adversarial verify (4 subsystem breaks incl. deleted payer recourse) → docs/23-settlement-models-and-provider-registry.md. Open: float model (prefund vs vendor-converts), charge-the-flat-fee, per-model order floor, THB timing, REVERSED auto-resolution, cross-account idempotency scope (unverified). All work on `stage` branch (stage→stage env, sacred→prod).
- 2026-08-14 · **LP marketplace: offer → lock → pay → release** (plan:
  `~/.claude/plans/merchant-side-of-app-distributed-dahl.md`; 6 phases, P1–P3 shipped). Staged
  broadcast with the lock as a `merchant_id` transfer (no offers table, invariant 14 intact);
  head start = the reputation reward; spread-ceiling filter = how speed pays without a bonus
  system. Corridors gained an ordered `settle` preference (provider-first, LP fallback) resolved
  through the provider registry, not a DB row — so UPI flips the day an India partner is enabled.
  `merchants.country` hard-filters the pool. Alerts are an adapter seam (Telegram now, FCM/APNs
  when mobile returns); web push rejected for now because SwKiller.tsx removes service workers.
  Fixed live: zero-stake LPs were routable for ~80s after approval; float was unbounded by bond.
  **Open**: migrations 0014/0015 unapplied (shared stage DB — Bridge runs `yarn db:migrate`);
  `check:rails` is RED at HEAD because its fix sits in a file another session is also editing;
  P4 (KYB evidence), P5 (warmth/hour-of-week routing), P6 (tiering, LP earnings, dispute view)
  not started; payer's in-flight order still not persisted across refresh (blocked on the same
  shared `usePayStore.ts`). Cut deliberately: shortened dispute window for high-tier LPs (trades
  payer protection for LP throughput — wrong side of that trade).
- 2026-08-13 · **Admin user moderation shipped** (handle renames admin-ONLY — users still can't self-change; display-name edits; suspend/reinstate with mandatory reason) — freed handles release INSTANTLY, Bridge's explicit accepted risk ("you have to manage your username"). Suspension = one gate in authPreHandler (admins exempt) + resolve-time receive-block + one-way merchant cascade; audit note `@old -> @new; reason` is the sole post-release history disambiguator → docs/24-admin-user-moderation.md. Cut-but-mandatory-later: recipient pinning + request-payment binding to `from_user_id` BEFORE self-service handle changes ever ship. Open for retro: does support need read-only access for suspended users; request-pay staleness window.
- 2026-08-24/25 · **Routing V1 rebalance shipped** (plan: `~/.claude/plans/linear-wondering-raccoon.md`;
  8 commits `1356d03`…`1569acc` on `stage`, unpushed). Cooldown 90→180d + partial index (0023);
  head start 20s→5s + reroute now re-alerts (bug found by the skeptic panel); weights
  .30/.14/.14/.10/.12/.08/.08/.04 (cost trimmed not floored — the payer's rate is a pure function
  of the struck spread with no rebate, so cost is the only payer-protecting signal; warm NOT raised
  — it measures a polling tab); reputation rates 90d with `settled` + `positive_rate` lifetime;
  **tier-priced spreads** (Bridge mid-loop: "the tier based prices we do set up" → per-tier caps,
  least()-clamped in the stats write); routing_* counters + `GET /admin/lp-activity` (Bridge: the
  summed histogram is the corridor's probabilistic capacity-by-hour). Spec items DROPPED with
  evidence: new RoutingAudit table (`order_routing_attempts` exists), 0.5-neutral normalize
  (routeQuality is dead output). Fleet: 8 lenses, 22/22 facts grounded, 4 claims × 3 skeptics
  (C1 settled/tier-gate + C4 no-rebate SURVIVED 3-0; C2 routeQuality-impact + C3 "5s≈zero"
  REFUTED 3-0 — both draft recommendations reversed). Divergence 0.71. Bridge's manual steps:
  `yarn db:migrate` (0023), real tier-cap numbers, push on ack.

- 2026-08-29 · **Manual partner onboarding while the identity vendor is dark** (plan:
  `~/.claude/plans/sparkling-growing-lagoon.md`; 6 code commits + 1 docs commit on `stage`,
  unpushed → docs/14-manual-onboarding-fallback.md). Persona has no production key, `/merchants/apply`
  required tier 2, and only Persona granted tier 2 — the partner funnel was shut. **Rejected** a
  parallel manual-KYC subsystem (new provider + `users.kyc_fields` + second admin queue + new sheet),
  which all three explorer lenses independently proposed: with the manual path scoped to LP applicants
  only, everyone who needs it is already filling in the 13-field KYB form that a human already reads
  in a queue that already exists. Shipped instead: `config.personaLive` as the one switch, the boot
  assert degraded, `/kyc/verify` 503ing before the network call, the apply gate keyed off the switch,
  `identity: true` on the KYB spec (+ NIK for Indonesia), and the KYB approval granting tier 2 with
  `kyc_provider='manual'` provenance. Found on the way and fixed: the reconciler aborted a whole pass
  on one bad session, `/sim/kyc/:tier` answered on mainnet stage, and the LP console watched for the
  previous vendor's return param so its Persona return never polled. **No migration** —
  `merchants.kyb_fields` is jsonb and `users.kyc_provider` already existed.
  **Open for retro:** (1) the `kyc_provider='manual'` re-verification sweep is owed and automated by
  nothing; (2) tier 2 raising manual users' own payer limits ($100→$1,000/tx) is unwanted exposure —
  the cheap close is a fourth KYC_TIERS row, not a new gate per call site; (3) is the compliance
  cash-out cap per PAYMENT or per LEG (still unverified, inherited from the routing plan).

- 2026-08-29 (second pass) · **Audit of the manual-onboarding change; the tier grant deleted** (plan:
  `~/.claude/plans/sparkling-growing-lagoon.md`; 7 commits `636cc52`…`6b4ffa3` on `stage`, unpushed).
  Three adversarial lenses over the diff; 6 claims grounded by re-reading source, 0 struck. The
  headline overturned the change's own central mechanism — see invariant 32. **Fixed:** sim
  unreachable off-local at the selector (it was still reachable on mainnet stage via `/kyc/verify`);
  the `x-dev-user-id` shim gated on `isLocal` (blanking a Privy var on stage was a no-token
  impersonation endpoint); the KYB tier grant deleted; `isMerchantTreasuryAddress` filtered to
  approved rows (one unreviewed application blocked every send to any address it named); the LP
  console re-reads the switch on the two screens that branch on it; the payer app stops offering a
  CTA that can only 503; `usableSecret` checks the credential prefix. Docs 02/06/07/11/14 corrected
  against the code on ten specific disagreements (`FP-` vs `FREN`, tier-2-to-apply stated as
  unconditional, "no rail refuses LPs" when two do, `users.status` deletion "TBD" when 0012 shipped
  it, five filters that are seven).
  **Open for retro:** (1) `appendKybEvent` can still throw between the CAS and the audit row, leaving
  a decided merchant with no timeline entry and an unretryable 409 — pre-existing, needs a
  transaction, deliberately not done here; (2) `POST /admin/merchants/:id/status` remains the one
  admin write with no state guard, no row check and no reason; (3) there is still no route that can
  LOWER a kyc_tier, which is fine now that nothing grants one manually but will matter the first time
  a vendor declines someone already approved; (4) is the compliance cash-out cap per PAYMENT or per
  LEG (still unverified, inherited from the routing plan).

## Telemetry (2026-08-29 audit pass)
- divergence: 0.69 (evidence 0.70, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=opus · skeptic panel NOT RUN (plan mode restricts subagents to Explore/Plan) — the
  load-bearing claims were grounded by re-reading source instead, which outranks cross-tier survival
- claims: tier-grant-buys-nothing · sim-on-stage · privy-shim-on-stage · treasury-unfiltered ·
  setKycSession-erases-provenance · cashout-503-on-mainnet — 6 grounded, 0 struck
- fleet: 3 lenses (attack / correctness / rules-cartography), differential file sets

## Telemetry (2026-08-29 manual-onboarding plan)
- divergence: 0.75 (evidence 0.81, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=opus · skeptic panel NOT RUN (plan mode restricts subagents to Explore/Plan) — every
  load-bearing claim grounded instead by re-reading source, which outranks cross-tier survival
- claims: boot-throws · apply-tier-gate · kyb_fields-jsonb · setKycApproved-greatest ·
  sim-live-on-stage · admin-hides-evidence-after-decide — all 6 grounded, 0 struck
- fleet: 3 explorer lenses (differential file sets), orchestrator judged

## Telemetry (2026-08-24 routing plan)
- divergence: 0.71 (evidence 0.85, conclusion 0.50) | threshold 0.30 UNCALIBRATED
- models: draft=fable · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: C1 grounded · C2 refuted-impact · C3 refuted · C4 grounded · grounding sweep 22/22 (0 struck)
- fleet: 8 lenses + 1 grounding verifier + 3 skeptics
