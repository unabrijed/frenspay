# 23 · Settlement models per corridor + the payout-provider registry

Status: DESIGN ADOPTED (build on `stage`) — 2026-08-11.
Source: prism-plan run (8 lenses + grounding pass + 3-skeptic adversarial verify, 2×Opus+1×Sonnet).
Full deliberation lives in the plan archive; this doc keeps what the repo needs.

> **Sim-phase framing.** Everything below is design-phase work against the simulated/devnet
> system. The failure modes named here were found *before* anything is live — they are build
> requirements, not incidents. Invariant 8 (docs/11) still stands: nothing real moves before
> KYC/AML vendor + sanctions + counsel sign-off.

## The one-line decision

A corridor's settlement is a **per-country entity and licensing commitment, expressed as one
registry field**: `model: 'lp'` (a marketplace of external liquidity providers settles the fiat
leg) or `model: 'provider'` (the platform itself settles it through a licensed payout provider —
no external merchant/LP network in that country).

## The two models, honestly compared

| | `lp` (marketplace) | `provider` (direct) |
|---|---|---|
| Who pays the fiat leg | an external LP from their own account | a licensed PSP, driven by our worker |
| Who we onboard | LPs: KYB, bonds, disputes, reputation | nobody — one vendor contract per country |
| Who carries payout licensing | nobody today (the recorded gap) | the provider (their license, their AML/tax incidence) |
| Who eats FX drift quote→settlement | the LP (their spread is their buffer) | **us** — an unhedged principal position |
| Payer recourse | dispute → LP bond draw | dispute → platform eats it (no bond fiction) |
| Platform revenue | zero (all spread accrues to the LP) | the corridor `spread_bps` — our first real revenue line |

**The regulatory headline** (synthesized from this repo's own record, nothing new): `lp` has **no
affirmative live-phase legal support in any corridor we've researched**. India rules it out in
writing — P2P INR settlement through personal accounts is the documented account-freeze failure
mode (`india-legal-compliance-brief.md`); Indonesia's recorded posture ("rent a PJP", docs/22)
implies provider; TH/PH/MY have no analysis either way. The LP marketplace is the *simulation*
structure (docs/08, docs/11 §9) — a live LP network would need licensing analysis nobody has done.
Reporting incidence is the real difference: `provider` lands AML/tax once, on a licensed entity;
`lp` distributes it across unlicensed counterparties while the platform still holds escrow release
authority — the worst of both.

## Per-country recommendation (from the repo's record only — not legal advice)

| Country | Rail | Live model | Candidates named in our docs | Posture recorded | Gaps |
|---|---|---|---|---|---|
| IN | UPI | provider (licensed float, `backend-architecture.md`) | Transcorp (PPI sponsor); conversion partner = gating dependency | PPI MD + FEMA + 194S/115BBH; P2P ruled out | counsel Qs 3/5/6 open; no named partner |
| ID | QRIS | provider (rent a PJP) | Xendit (test mode) | BI bans crypto payment; POJK 27/2024; PJP capital 500m–15bn | entity+KYB per country; NMID→disbursement mapping; PDP unrecorded |
| TH | PromptPay | provider **or defer** | Xendit TH (unverified) | SEC 5/2565 — region's sharpest ban | whether IDR-style "THB→THB contract" survives 5/2565: unanalysed |
| PH | (no rails entry) | provider | PayMongo (disbursements KYB-gated), Xendit PH | "easiest overall" (docs/22) | not a supported country until a rails entry exists |
| MY | DuitNow | provider (presumptive) | Xendit MY | "low regulatory temperature" — the whole record | zero MY licensing analysis |
| BR | Pix | — | none | **zero legal record in the repo** | research before anything, or drop the registry row |

## How `provider` is implemented: the platform settlement row

A `model:'provider'` corridor settles through **one platform-owned `merchants` row**
(`sim_behavior='psp'`, `user_id NULL`, `treasury_address` = `PLATFORM_TREASURY_ADDRESS`,
`spread_bps` = the corridor take). This is deliberate, not a shortcut: the row *is* the platform
acting as the corridor's settlement counterparty — which is also the legally accurate description
of the provider model — and it keeps the whole existing machine (escrow release, `claimOrderPayout`
CAS, **the payer's dispute button**, SLA, stats) working. The alternative (`merchant_id NULL`
end-to-end) was adversarially tested and rejected: it silently breaks four subsystems, including
deleting the payer's only recourse.

Required accompaniments (each verified against code, adversarially):
- **Routing never crosses rails.** The old cross-rail fallback leaked both directions (a rerouted
  QRIS order's escrow released to a happy UPI sim; a UPI order quoted against the QRIS platform
  row into a guaranteed refund). Rail is a hard filter now.
- **Platform rows are exempt from bond draws.** The platform fining itself is fiction, and the
  only bond top-up path is `user_id`-gated — a drained platform row would strand the corridor
  permanently. Upheld dispute on a provider order: payer refunded, platform eats the double loss,
  `risk_events` records it. Admin-suspending the platform row is the deliberate corridor kill
  switch.
- **Seed can't wipe it.** Platform rows live in a fixed-uuid upsert, outside the delete+insert sim
  block.
- External LP applications are rejected on provider-model rails (`rail_not_open_to_lps`).

## The provider registry (`payout_providers`)

One vendor ≠ one provider: each live country is its own vendor account, entity, and credentials
(`xendit_id`, `xendit_th`, … — docs/22 recorded this; the registry now models it). Rows are
routing metadata only: `id · adapter · payout_method · priority · enabled`. Adapters are code;
credentials are env (`XENDIT_ID_SECRET_KEY`, `XENDIT_ID_CALLBACK_TOKEN`), resolved through the
tier chain and enumerated in `envConfig.payoutSecretKeys` — never the DB, never raw `process.env`.

**Safety invariants** (also recorded in `.prism/project-model.md`):
1. **A DB row is never sufficient to move money.** Registry membership = credential resolves AND
   row enabled. A keyless enabled row is inert and logged loud at boot. The admin console can only
   *subtract* (disable, reorder); enabling a new money-mover requires a deploy. The `sim` adapter
   is excluded from the adapter map in production.
2. **Refund and failover require a raw terminal provider status.** The worker keeps polling while
   an order is escalated; a non-terminal payout at the refund decision point freezes the order
   instead of refunding (the alternative is the payer keeping USDC while the fiat settles —
   the double-pay found 3/3 by the skeptic pass in the *previous* psp path).
3. **`orders.payout_provider_id` is claimed before the first `initiate`** and never silently
   reassigned. Vendor idempotency does not span accounts; stickiness is what makes an admin flip
   or a restart safe. Sticky orders keep polling a disabled row — disable affects selection only.
4. **`REVERSED` never fails over.** It means money moved and came back — the order freezes with a
   `payout_orphaned` event + `risk_events` row for a human. (Vendor docs say funds return to our
   balance, so auto-refund may become the live-phase resolution — deliberately unresolved.)
   `REJECTED` is terminal-failed (the old mapping treated it as pending — a real bug). Post-claim
   reversals are caught by the webhook's terminal handling and a final `provider.check()` before
   escrow release.
5. **The webhook is a hint, never the authority**: per-provider route
   (`/webhooks/xendit/:providerId`), that row's token compared timing-safe, order↔provider
   asserted, then the claim happens only after `provider.check()` re-derives the status — and a
   failed claim is recorded, never dropped (a silent 200 kills the vendor retry that would have
   surfaced a refund race).

## Economics (what decides whether a corridor is viable)

- **Fees are display-only today.** `FLAT_FEE_USD 0.45` + `NETWORK_FEE_USD 0.09` are computed,
  persisted, and shown — and collected by no one; escrow funds and releases exactly `amountUsdc`.
  The only real take is the spread folded into the rate, and in the `lp` model it accrues to the
  LP's treasury. The provider model's corridor `spread_bps` is therefore the platform's **first
  real revenue — and its only buffer** against vendor fees and FX drift.
- **The FX window is ~24h, not 45s.** The mid comes from a once-daily source on a 6h refresh with
  no hedging; plausibility bands catch garbage, not drift. In `lp` the LP carries that; in
  `provider` we do. A 1% IDR move at a 60bps spread ≈ −40bps net per order.
- **`MIN_ORDER_USD=1` is a dust guard, not an economics floor.** Vendor payout fees are flat,
  revenue is proportional: break-even sits roughly $30–110 depending on spread and an *assumed*
  fee (no verified Xendit fee figure exists in this repo). Options: a per-model floor, or actually
  charging the displayed flat fee.

## Deployment

Stage API `https://stage.api.frenspay.xyz` · prod API `https://api.frenspay.xyz`. Vendor
dashboards are configured per environment: the stage vendor account's callback URL is
`https://stage.api.frenspay.xyz/webhooks/xendit/<providerId>`, prod
`https://api.frenspay.xyz/webhooks/xendit/<providerId>` — the path names the provider row whose
token signs it. Branch model: `stage` branch → stage env; `sacred` → prod.

## Open items

- [ ] **Float model** (business): prefund IDR at the vendor (we carry FX + a treasury clock) vs
      vendor converts at disbursement (we pay their spread, ~no FX). Decides whether the FX
      section above is a risk register or a pricing input.
- [ ] **Charge the displayed $0.45?** Nearly free to do — it's already computed/persisted/shown.
- [ ] **Per-model order floor** vs loss-making small orders as CAC.
- [ ] **THB/PromptPay timing** — after this lands it's one registry entry + one platform row;
      SEC 5/2565 makes its live phase the hardest of the five.
- [ ] REVERSED auto-resolution semantics (live phase, with verified vendor behavior).
- [ ] Cross-account idempotency scope is vendor-doc **unverified** — stickiness assumes the unsafe
      case; verify on first two-account sandbox.
- [ ] docs/11 still needs its jurisdiction axis (Indonesia BI/OJK/PJP/PDP section — carried from
      docs/22; plus TH PDPA, PH DPA, entity/incorporation, 194S/115BBH tax, FIU fields).

## Telemetry (prism)

- divergence: 0.59 (evidence 0.70, conclusion 0.42) | threshold 0.30 UNCALIBRATED
- models: draft=opus · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: refund-race grounded · fees-never-charged grounded · platform-row struck→amended
  (amendments grounded via skeptic citations) · raw-status-discipline grounded ·
  cross-account-idempotency cross-tier-survived (vendor-doc unverified)
- fleet: 8 lenses + 1 grounding verifier + 3 skeptics; grounding 18/20 verified, 2 corrected

> Cross-tier verification reduces instance-/tier-level error correlation but not shared-lineage
> blind spots. Treat cross-tier survival as weaker evidence than grounding.

Skeptic-pass changelog: `merchant_id NULL` → platform settlement row (4 subsystem breaks, incl.
deleted payer recourse) · "zero changes" → seven named amendments (cross-rail leak, SLA, bond
exemption, seed upsert, type union, treasury-block documented, docs framing) · REVERSED-freeze
extended post-claim (poll and webhook both stop at `payout_claimed_at`) · REJECTED-is-pending bug
found · same-account double-pay ruled impossible (idempotency, no expiry) and same-reference retry
ruled impossible with it.
