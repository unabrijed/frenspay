# FrensPay — Architecture & Flows

> A plain-English map of **how this product works, why each piece is built the way it is, what
> legal/compliance question it touches, and how finished it is.** Read top-to-bottom for the full
> picture, or jump to the doc you care about.

The product is a **consumer money app** — you hold a dollar balance, send money to friends by
name or number, and (later) pay out to local rails — built on **stablecoins (USDC) on Solana**,
with the crypto deliberately hidden. **Both deployed environments (stage and prod) run mainnet**;
devnet exists only in local dev.

This set was rewritten **from scratch on 2026-08-13** and extended on **2026-08-14** for the LP
marketplace (the offer/lock mechanism, KYB evidence, tiering, the alert seam, and
[11](11-lp-console.md), the LP console) around the locked base design (one user =
one email = one handle; email-only entrance; admin moderation; USDC-only deposits; FREN invite
codes; a flat $0.001 conversion fee folded into the rate; dual-currency balance display; minimal
home). Superseded docs live in git history only — nothing stale stays in this folder to sway a
future reader.

---

## How to read these docs

Flow docs follow the **same six-part shape**, so you always know where to look:

| Section | Answers |
|---|---|
| **What it is** | one-paragraph definition |
| **Flow** | a diagram of how it actually moves |
| **Why this way** | the design decision + the tradeoff |
| **Legalities** | the regulatory question it touches, and how we handle or *defer* it |
| **Status** | how done it is |
| **Key files** | where it lives in the repo |

### Status legend

- ✅ **Complete** — built, wired, verified (at least headlessly).
- 🟡 **Gray** — exists but simulated, partial, or cosmetic (not production-real).
- ⬜ **Planned / decided** — designed (many marked "decided 2026-08-13, gap to close"), not built.
  Docs describe the *decided* system and mark every gap honestly — they never claim unshipped
  behavior.

---

## The docs

| # | Doc | Covers |
|---|---|---|
| 01 | [Architecture](01-architecture.md) | the whole system, monorepo layout, request + on-chain lifecycle, mainnet posture |
| 02 | [Identity & onboarding](02-identity-and-onboarding.md) | email-only entrance, one-email/one-handle rule, invite codes (FREN remint), phone/country aliases, KYC tiers |
| 03 | [Custody, money-in & confirmation](03-custody-money-in-and-confirmation.md) | self-custody (the key legal lever), fee-payer gas, USDC-only deposits, how the chain tells the app |
| 04 | [P2P & contacts](04-p2p-and-contacts.md) | send by handle/phone/address, requests, contacts, the minimal Add/Send home |
| 05 | [Fees, FX & display](05-fees-fx-and-display.md) | the flat $0.001 conversion fee folded into the rate, per-currency FX, dual-currency balance + flip + eye-hide |
| 06 | [Offramp & settlement](06-offramp-and-settlement.md) | quote → escrow → route → payout as one machine; an ordered `settle` preference per corridor — provider-direct (Xendit) with the LP pool as fallback; corridor economics |
| 07 | [Admin & moderation](07-admin-and-moderation.md) | roles, suspend/reinstate, admin renames, audit trail, soft-delete (decided), ban = suspend + denylist |
| 08 | [Compliance & legalities](08-compliance-and-legalities.md) | the honest risk map: custody, KYC, MTL, FX, sanctions, retention |
| 09 | [Data model](09-data-model.md) | the Postgres schema table-by-table, migration conventions |
| 10 | [Ops & roadmap](10-ops-and-roadmap.md) | deploy model, infra hardening, KYC runbook, and everything gated or decided-but-unbuilt |
| 11 | [The LP console](11-lp-console.md) | the app the people who settle our payouts use — notifier, scoreboard, stake. **No money moves through it** |
| 12 | [The mobile app](12-mobile-app.md) | Expo/React Native rendering the same `@fpay/app` the web does — the platform seam, the `.native` twins, Privy Expo, Persona in-app, push; what is not yet device-verified |
| 13 | [The Telegram bot](13-telegram-bot.md) | the LP console's second renderer, inside Telegram — the link handshake, working orders from chat, phone-at-apply; **drafted ahead of implementation**, setup steps included |
| 14 | [Onboarding when the vendor is off](14-manual-onboarding-fallback.md) | the `personaLive` switch, and the human review that admits partners while the identity vendor has no production key — includes the audit of why it must NOT grant a tier |
| 15 | [The closed pilot](15-pilot-escrow-and-bond.md) | escrow to mainnet under a new id, the chain asked before any row flips, settlements written on landing, and a bond system with a ledger, a floor it can cover, a claw window and an exit that is a flag — the decision record, with its verification |
| 16 | [The escrow pool, and the shelved program](16-escrow-pool-and-the-shelved-program.md) | the program audit (dust-lock, refund-to-anyone, what a deploy really costs), why the pilot's escrow is a pooled token account under a backend key, the two PDA guarantees re-implemented (memo attribution, status-checked write-off), webhook-first recovery, and the keys |

**Deployment is not a numbered doc** — the runbooks live at the repo root, next to the code they
deploy: [`DEPLOY.stage.md`](../DEPLOY.stage.md) and [`DEPLOY.md`](../DEPLOY.md). One architecture
fact worth knowing from them: the web app and the LP console ship server-side code (the access-key
gate — `src/middleware.ts` + `/gate`, one key per project), so they deploy as Next servers, not
static exports.

**One-line mental model:** the **client** asks the **backend** to *build* a transaction, the
**user** signs it (via Privy), the **fee-payer** sponsors the gas, the **chain** executes it, and
a **confirmer + webhook** tell the backend it landed. The full walk-through and system diagram
live in [01-architecture](01-architecture.md).

---

## Regenerating the single-page HTML

`architecture.html` is the whole set as one diagram-rich page, built from the Markdown with no
installed packages (`marked` + `mermaid` from a CDN at view time):

```bash
node docs/build-architecture-html.mjs      # writes docs/architecture.html
```

Open it in a browser (diagrams render client-side); Print → Save as PDF if a PDF is needed —
none is checked in. Edit the `.md` files (the source of truth), then re-run.
