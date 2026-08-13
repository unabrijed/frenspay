# FrensPay — Architecture & Flows

> A plain-English map of **how this product works, why each piece is built the way it is, what
> legal/compliance question it touches, and how finished it is.** Read top-to-bottom for the full
> picture, or jump to the doc you care about.

The product is a **consumer money app** — you hold a dollar balance, send money to friends by
name or number, and (later) pay out to local rails — built on **stablecoins (USDC) on Solana**,
with the crypto deliberately hidden. **Both deployed environments (stage and prod) run mainnet**;
devnet exists only in local dev.

This set was rewritten **from scratch on 2026-08-13** around the locked base design (one user =
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
| 06 | [Offramp & settlement](06-offramp-and-settlement.md) | quote → escrow → route → payout as one machine; provider-direct (Xendit) vs merchant rails (`lp`); corridor economics |
| 07 | [Admin & moderation](07-admin-and-moderation.md) | roles, suspend/reinstate, admin renames, audit trail, soft-delete (decided), ban = suspend + denylist |
| 08 | [Compliance & legalities](08-compliance-and-legalities.md) | the honest risk map: custody, KYC, MTL, FX, sanctions, retention |
| 09 | [Data model](09-data-model.md) | the Postgres schema table-by-table, migration conventions |
| 10 | [Ops & roadmap](10-ops-and-roadmap.md) | deploy model, infra hardening, KYC runbook, and everything gated or decided-but-unbuilt |

**Deployment is not a numbered doc** — the runbooks live at the repo root, next to the code they
deploy: [`DEPLOY.stage.md`](../DEPLOY.stage.md) and [`DEPLOY.md`](../DEPLOY.md). One architecture
fact worth knowing from them: the web app ships server-side code (the access-key gate —
`src/middleware.ts` + `/gate`), so it deploys as a Next server, not a static export.

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
