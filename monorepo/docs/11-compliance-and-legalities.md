# 11 · Compliance & Legalities (the honest risk map)

> **Not legal advice.** This is an engineering-level map of *which regulatory questions each part of
> the product touches, how the current design handles or defers them, and where the gray zones are.*
> Every item marked for a real launch must be confirmed with qualified counsel in each target
> jurisdiction.

## The core thesis: simulated-rails-first keeps us out of scope

The product is built **structure-first with simulated rails**: real on-chain escrow and a real order
lifecycle, but a **simulated merchant/LP network**, a **quoted (not live) FX rate**, a **devnet
faucet instead of a real on-ramp**, and **no real fiat payout**. Because **no real customer money and
no real fiat movement occur**, almost none of the heavy regulation is *triggered yet*. The design
intent is that each regulated edge has a **clean seam** where a licensed partner or vendor plugs in at
the milestone that needs it — so we build the whole machine now and turn on the regulated parts last
(M5 compliance, M7 real rails).

## The risk map

```mermaid
flowchart TB
    subgraph green["✅ Handled by design (lowers exposure)"]
      C1["Self-custody — user holds key,<br/>platform never holds funds/keys"]
      C2["Gas sponsorship — product cost,<br/>not a regulated activity"]
      C3["On-chain escrow — trust-minimized<br/>conditional settlement + audit events"]
      C4["Audit substrate — full ledger +<br/>routing trail + on-chain proofs"]
    end
    subgraph gray["🟡 Gray (exists but simulated/cosmetic)"]
      G1["KYC tiers — UI only, not enforced"]
      G2["FX rate — hardcoded constant"]
      G3["Escrow release authority —<br/>platform-held (operationally trusted)"]
      G4["PII/data — minimal, no retention policy"]
    end
    subgraph red["⬜ Deferred to real rails (M5/M7)"]
      R1["KYC/AML vendor + enforcement"]
      R2["Money-transmission licensing /<br/>VASP / PSP partnerships"]
      R3["Sanctions / address screening"]
      R4["Real on-ramp + payout (fiat)"]
      R5["Transaction monitoring, velocity,<br/>geo, fraud scoring"]
    end
```

## Topic by topic

### 1. Custody & money transmission — ✅ *lightened by design*
Holding customer funds/keys is what triggers the heaviest rules (US state **MTL** / FinCEN **MSB**, EU
**VASP/EMI**). The app is **non-custodial**: the user signs every movement of their own funds; the
platform only sponsors gas. This is the **single biggest lever** keeping us in a lighter
classification during the build. **Caveat:** the per-order escrow does put funds under *program*
control briefly — see #3. *(The custody/MTL line is fact-specific and jurisdiction-specific; confirm
with counsel before real funds move.)*

### 2. KYC / customer identification — ✅ *enforced (M5); real vendor at M7*
The tiered model is now **enforced**: `users.kyc_tier` gates money movement (tier 1 P2P ≤ $100/tx; tier
2 unlocks merchant pay), checked server-side against rolling-24h volume, with a simulated verification
upgrade. **Still simulated** for the vendor leg — no real document collection / KYC-AML provider
(Persona/Onfido/Sumsub land at **M7**).

### 3. Escrow release authority — 🟡 *platform-held*
The escrow is trust-minimized (funds can only go to the intended merchant or back to the user), but the
**release authority is the platform's fee-payer** — so *operationally* we decide when to release. A
fully trust-minimized off-ramp constrains this further (payout-proof-conditioned release, time-locked
auto-refund, or multisig). This is the main legal gray of the payout flow. See [07](07-onchain-escrow.md).

### 4. FX & consumer disclosure — 🟡 *quoted, not live*
Quoting INR↔USD with a spread has consumer-protection (and sometimes licensing) implications. The
quote screen **does** itemize rate + fees (good), but the **rate is a hardcoded constant**. A real
launch needs a live FX source and clear, accurate disclosure. **M7.**

### 5. On-ramp / payout (real fiat) — ⬜ *deferred to M7*
Converting fiat↔crypto and paying out to bank rails (UPI/Pix/bank) is the **regulated core** and needs
**licensed partners** (PSP/MSB/VASP) who carry the fiat-leg licenses, plus KYC + source-of-funds at
entry. Deliberately last; the faucet/simulated payout move nothing of legal consequence until then.

### 6. AML / sanctions / monitoring — 🟡 *structure built (M5); real lists/geo at M7*
Sanctions/address **screening** (against a seeded denylist), a per-tx **fraud score** (allow / review /
block), and rolling-volume monitoring are **built and wired** (M5), writing a **`risk_events`** audit
trail. **Simulated**: the denylist is seeded (not a live OFAC/sanctions feed) and geo checks are
deferred (need IP). Real lists + a monitoring vendor land at **M7**.

### 7. Best-execution / fair routing — ✅ *evidenced*
A routing marketplace should prove it isn't self-dealing. The `order_routing_attempts` log + explicit
scoring weights ([08](08-routing-and-failover.md)) are the evidence trail. (Not user-facing by choice.)

### 8. Data / privacy — 🟡 *minimal*
`users` holds email/phone/handle. A real launch needs a privacy policy, retention limits, encryption at
rest, and regional handling (India **DPDP**, **GDPR**). Minimal today.

### 9. Merchant/LP network (KYB) — 🟡 *modelled (M4 ✅), real vendor deferred to M7*
The **structure** is now built ([08](08-routing-and-failover.md)): KYB lifecycle (`kyb_status`,
onboarding/approval gating), performance scoring from real outcomes, **bonds** (skin-in-the-game,
auto-suspend below a floor), and a **dispute** open/resolve flow that draws the bond down. Still
**simulated** — no real KYB vendor, contracts, payout, or arbitration — so no real counterparty risk
yet; those flip at **M7**.

## Summary table

| Topic | Posture | Status | Closes at |
|---|---|---|---|
| Custody / money transmission | non-custodial (lighter class) | ✅ by design | (revisit M7 w/ counsel) |
| Gas sponsorship | product cost | ✅ | rate-limit M6 |
| Escrow conditional settlement | trust-minimized | ✅ structure / 🟡 authority | hardening later |
| KYC tiers | enforced per-tier caps (sim vendor) | ✅ M5 / 🟡 vendor | vendor **M7** |
| AML / sanctions / monitoring | screening + fraud score built (sim) | 🟡 M5 | real lists **M7** |
| FX & disclosure | itemized but fixed rate | 🟡 | **M7** |
| On-ramp / payout (fiat) | simulated | ⬜ | **M7** |
| Merchant KYB / bonds / disputes | structure built (M4 ✅), simulated network | 🟡 | real vendor **M7** |
| Data / privacy | minimal | 🟡 | pre-launch |

## Bottom line

The app is intentionally on the **light side of regulation** today because it holds no customer funds
and moves no real fiat. **KYC enforcement + sanctions screening are now built (M5, simulated vendor);**
the remaining **gray** items (FX, escrow authority, PII) are known and seamed, and the **deferred**
items (licensing, real rails, real KYC/AML + sanctions feeds) are sequenced into **M7** where a licensed
partner carries the regulated leg. The thing to *not* do: flip on a real on-ramp or real payout before
the real KYC/AML vendor + sanctions lists + counsel sign-off.

## Related

[03 Custody & gas](03-custody-and-gas.md) · [07 Escrow](07-onchain-escrow.md) ·
[12 Status & roadmap](12-status-and-roadmap.md) · [13 Future milestones](13-future-milestones.md)
