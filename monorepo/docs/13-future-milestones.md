# 13 · Future Milestones (M6 → M7)

The unbuilt half of the roadmap, documented to the same standard so the full vision is on paper. Each
is **⬜ planned**. These flip the remaining **simulated** components ([11](11-compliance-and-legalities.md))
into **real** ones, in dependency order: harden the infra (M6), then connect real money (M7). *(M5 —
compliance/KYC enforcement + screening — is **✅ built** (simulated vendor), as is the M4 merchant
layer; see [12](12-status-and-roadmap.md).)*

```mermaid
flowchart LR
    M5["M5 ✅<br/>compliance & risk"] --> M6["M6<br/>notifications + infra"]
    M6 --> M7["M7<br/>real rails (mainnet)"]
```

---

## M6 · Notifications + Infra Hardening

**What it will be.** Production infrastructure: a **notification service** (push/webhooks/reminders —
"you paid ₹X to Y", "Z sent you $A"), **Redis** for queues/locks/quote-cache, **API-gateway
rate-limiting** (incl. protecting the fee-payer from abuse), and **observability** dashboards.

**Why.** Today there's one in-process 8s poller and no rate-limiting — fine for devnet, not for
production load, abuse resistance, or operability. This is the "make it survive real traffic" milestone.

**Legalities.** Operational resilience + abuse prevention are themselves compliance expectations for a
payments operator; rate-limiting the fee-payer prevents a spam-drain DoS.

**Status.** ⬜ Planned. The confirmer/worker move from an in-process tick to real queues; notifications
read the existing `transfers`/`order_events` data.

---

## M7 · Real Rails

**What it will be.** Flip every simulated component to production: a **live FX source**, **real payout
providers** (UPI/Pix/bank), **KYC/AML vendors** live, and **mainnet** USDC (Circle's real mint)
instead of a controlled devnet mint. The faucet becomes a **real on-ramp** (card/bank/Apple Pay via a
licensed partner).

**Why.** The endgame: real users moving real money. Everything before M7 exists so that this switch is
a *configuration + partnership* change, not a re-architecture.

**Legalities.** The **regulated core**: licensed on-ramp/payout partners (PSP/MSB/VASP) carrying the
fiat legs, live KYC/AML enforcement, FX disclosure, mainnet custody/key hardening (HSM/KMS/multisig for
the fee-payer + constrained escrow authority). **Counsel sign-off required before launch.**

**Status.** ⬜ Planned. Seams are everywhere by design: `USDC_MINT` → Circle's mint; `solana.ts` faucet
→ on-ramp partner; simulated LP payout → real PSP; `MID_RATE` constant → live FX; devnet → mainnet RPC.

---

## The throughline

Every future milestone replaces a **simulated edge** with a **real, licensed one** at a **seam that
already exists** in the code. That's the payoff of "build the structure with simulated rails first":
the hard architecture is done; what remains is partnerships, vendors, and turning regulated features on
in the right order. See [12-status-and-roadmap](12-status-and-roadmap.md) for the current heat-map.
