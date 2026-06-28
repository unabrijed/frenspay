# 13 · Future Milestones (M7)

The last unbuilt milestone, documented to the same standard so the full vision is on paper. **M0–M6 are
✅ built** (simulated rails where needed; see [12](12-status-and-roadmap.md)) — M7 flips every remaining
**simulated** edge ([11](11-compliance-and-legalities.md)) into a **real, licensed** one.

```mermaid
flowchart LR
    M6["M6 ✅<br/>notifications + infra"] --> M7["M7<br/>real rails (mainnet)"]
```

---

## M7 · Real Rails

**What it will be.** Flip every simulated component to production: a **live FX source**, **real payout
providers** (UPI/Pix/bank), **KYC/AML vendors** live, and **mainnet** USDC (Circle's real mint)
instead of a controlled devnet mint. The faucet becomes a **real on-ramp** (card/bank/Apple Pay via a
licensed partner). Plus the **infra-scale carry-overs from M6**: **Redis** (multi-instance locks/queues/
quote-cache), a shared rate-limit store, a real metrics scrape target, and **real push/webhook**
notification delivery (FCM/APNs) over the in-app inbox.

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
