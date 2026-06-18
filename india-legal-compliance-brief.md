# India Launch: Legal and Compliance Requirements Brief

For counsel. This sets out the structure we have committed to and the questions we need answered.
Facts below are as we understand them. Please correct anything that is wrong, since some of our
build decisions depend on these.

---

## 0. What we are building

A payment app for inbound foreign travelers to India, plus a friends and peer-to-peer layer.

- A user holds a USD-denominated balance as USDC in a self-custodial wallet (embedded, passkey
  login, gas sponsored, on Solana). We do not hold the user's keys or deposits.
- Two phases, with different regulated surface:

Phase 1, building now:
- Self-custodial USDC wallet plus wallet-to-wallet USDC transfers between users.
- No INR, no merchant payments, no fiat held by us, no conversion.

Phase 2, next:
- A foreign traveler pays Indian merchants in INR.
- The INR is pre-funded as a float held inside a licensed partner and replenished in batches.
- A licensed Indian entity converts USDC to INR at the treasury level, in bulk, not per
  transaction.
- Spend reaches merchants via the UPI One World prepaid instrument and/or card rails.

What we have deliberately ruled out, and why, so the structure is clear:
- Peer-to-peer settlement of INR through individuals' personal bank accounts. This is the
  structural cause of the account-freeze problem in India (cyber-cell liens on accounts that
  receive funds later traced to fraud), so it is out.
- Holding INR float for users on our own books. That makes us an unlicensed wallet or PPI issuer.
- Converting USDC to INR per user transaction. That triggers 1% TDS on every spend.
- Relabeling stored value as reward points to avoid prepaid-instrument rules.

---

## 1. The questions we need answered

Grouped by what they gate.

### Gates Phase 1 (now)

1. Registration trigger. Does operating a self-custodial USDC wallet with user-to-user transfers,
   holding no INR and no user fiat ourselves, make us a VDA Service Provider and a PMLA reporting
   entity that must register with FIU-IND? What is the trigger, and what are the ongoing
   obligations, including the January 2026 collection requirements (live identity verification,
   plus IP, timestamp, geolocation, device ID, wallet address, and transaction hash)?

2. Entity structure. What is the cleanest structure given an India-targeted product on crypto
   rails: an Indian entity, or a foreign entity with an Indian arm? Note that India is joining the
   Crypto-Asset Reporting Framework (CARF) and that FEMA treatment of offshore crypto holdings is
   still unresolved, so an offshore pool is a lever but not invisible. We need the structure that
   minimizes our regulated surface without relying on opacity.

### Gates Phase 2 (next)

3. Core legality. Is the model permissible: a foreign traveler funding a UPI One World PPI, or a
   card, where the source of funds is USDC converted to INR by a licensed Indian partner? Any FEMA,
   RBI, or PPI Master Direction problems with crypto-sourced funding of a PPI?

4. TDS under Section 194S. The 1% TDS applies to the USDC-to-INR conversion. Who is the deductor,
   can batching the conversion at the treasury level keep it off individual user transactions, and
   how is it reconciled and credited?

5. Tax characterization of our margin. Confirm that Section 115BBH (30% plus cess) applies to gains,
   not gross, so the conversion of a stablecoin held briefly produces a near-zero base. The open
   question that moves the number: is our FX spread or margin treated as VDA transfer income, taxed
   at 30% with only cost of acquisition deductible, or as a service fee taxed as ordinary business
   income with deductions? Also confirm the no-loss-offset implication for a treasury that converts
   continuously, and whether tight, same-day conversion timing is the right way to keep the gain
   base and FX exposure minimal. This is the single item we most need a clear opinion on.

6. The conversion partner. What license must our USDC-to-INR conversion partner hold, and can the
   VDA Service Provider and reporting obligations sit with that partner rather than with us? This
   partner is our gating dependency: if no licensed entity can deliver INR off USDC to fund the
   float, the merchant-payment product does not exist.

7. UPI One World specifics. The path to issuing or partnering for a One World PPI for foreign
   travelers: the authorized issuer or sponsor (for example Transcorp), the caps (around ₹25,000
   per transaction, ₹50,000 per month, two loads per month), passport-plus-visa KYC, the
   refund-to-source-under-forex rule, and crucially whether a PPI can be funded from a
   crypto-sourced conversion at all, given it is still a pilot programme.

8. KYC and AML. Onboarding tiers for the crypto layer versus passport-and-visa for the PPI,
   sanctions and risk screening, travel-rule handling, FIU reporting obligations, and data
   retention per the January 2026 requirements.

9. Data localization. RBI's requirement that payment system data be stored in India, and how it
   applies to our architecture.

---

## 2. Facts we are operating on (please verify or correct)

- Section 194S: 1% TDS on the transfer consideration for a VDA, in force since 1 July 2022, applies
  to both exchange and peer-to-peer transfers.
- Section 115BBH: 30% plus 4% cess on income from transfer of a VDA. Only cost of acquisition is
  deductible. Losses cannot be offset across assets or against other income. Conversion of a VDA to
  INR is a taxable event. Stablecoins are VDAs, and the Finance Act 2025 added an explicit
  crypto-asset clause from 1 April 2026.
- UPI One World: a prepaid instrument for inbound foreign travelers, issued through an authorized
  PPI issuer, KYC on passport plus valid visa, current caps around ₹25,000 per transaction and
  ₹50,000 per month with two loads, unused balance refundable to the original source under forex
  rules. As of early 2026 it is still a pilot tied to event cohorts.
- FIU-IND and PMLA: entities handling crypto flows as a service are reporting entities, with live
  identity verification and detailed data collection required from January 2026. FIU registration
  is not a license or an endorsement.
- The account-freeze problem: accounts that receive INR later traced to fraud are frozen by
  cyber-cells, often the entire balance, which is why we will not route retail INR through personal
  accounts.
- CARF and FEMA: India is expanding offshore visibility through CARF, and offshore crypto FEMA
  treatment is unresolved.

---

## 3. Priority

Two items unblock everything: question 5 (how our margin is characterized for tax) and questions 3
and 6 (whether USDC-to-INR via a licensed partner to fund a PPI is permissible, and what license
that partner needs). If 3 and 6 fail, the merchant-payment product cannot exist in this form, so we
need your read there first.

---

## 4. What we are asking for

A short written view on the Phase 1 items (questions 1 and 2) this week, so we can keep building the
wallet layer, and a working session on the Phase 2 and tax items. We are not asking for sign-off on a
finished structure, we are asking where the structure breaks so we can design around it.

This brief is our understanding for discussion, not legal advice.
