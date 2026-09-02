# 15 · The closed pilot: escrow on mainnet, and a bond system that functions

_Decision doc, 2026-08-30. Produced by a prism-plan run (two rounds, twelve lenses, two grounding
passes, six skeptics); the verification record and telemetry are at the end. Companion to
[06](06-offramp-and-settlement.md) (the machine), [11](11-lp-console.md) (the console) and
[14](14-manual-onboarding-fallback.md) (the vendor-off posture)._

> **Superseded in part, 2026-08-31.** Decision 2 — deploy the program — did not happen: the program was
> audited (a CRITICAL dust-lock, a HIGH refund-to-anyone) and **shelved**; the pilot's escrow is a
> backend-held **pool** under a dedicated key. Everything that mentions a vault, a PDA or the program
> id below is history; [16](16-escrow-pool-and-the-shelved-program.md) is current. Decisions 1, 3, 4
> (as re-implemented for the pool) and 5 stand.

## What was decided

fpay goes live for a **closed pilot** on mainnet — two accounts, both Bridge's, one payer and one
partner, paying Bridge's own UPI VPA — and the bond system is rebuilt so that money a partner puts
up can be accounted for, drawn against fairly, and given back.

1. **There is no testnet.** Every tier is mainnet. `isMainnet` is gone as a concept and so is
   everything only a testnet made safe: the faucet, the `/sim/orders/*` controls, the seeded
   simulated LPs (their "treasury" was a keypair derived from a public string), the Sepolia CCTP
   table, the devnet provisioning script. What a tier can *do* is a **capability** the backend
   derives from its own config at boot — `escrowLive`, `personaLive`, the stake treasury, the EVM
   minter — never a cluster flag.
2. **The escrow program ships to mainnet under a new id.** The devnet program's keypair is not on
   disk or in git, and an upgrade authority cannot create the same id on another cluster (the CLI
   is explicit: `--program-id` "must be a signer for initial deploys"). The forced rebuild carries
   two program changes: `Deposit.authority` becomes a signer (only the platform can create an escrow
   under a reference — costs nothing, the fee-payer already signs), and **the platform fee moves
   inside the escrow**: the vault holds the full amount, `release` pays the partner `amount − fee`
   and the earnings wallet `fee` in one instruction, `refund` returns the whole amount. The
   fee-payer now holds gas and nothing else.
3. **The database believes nothing about a signature until the chain agrees.** A `transfers` row is
   client-declared and `/transfer/submit` attaches whatever signature the client posts. Confirmation
   used to ask only "did it land?" — so any confirmed mainnet signature advanced an escrow order over
   an empty vault, or credited a stake with no USDC moved, levered 3× against real payer escrow.
   `services/transferVerify.ts` asks the second question, before the status flips, on both
   confirmation paths: a plain send must parse to one SPL transfer of the exact amount to the
   recipient's ATA from the sender; an escrow deposit is checked by reading each leg's vault.
4. **A settlement is written when it lands, not when it is sent.** Release and refund wait (bounded)
   for the chain; an order with a settlement tx in flight never broadcasts another; the escrow PDA
   being gone is the one idempotency truth a release and a refund share. A deposit that landed but
   the DB never saw is found by reading vaults every tick.
5. **The bond.** A floor of **$100** (= the tier-1 payer's per-transaction cap), tier-1 leverage of
   **1×** (in flight ≤ bond), and a penalty of **min(bond, the order's amount)** — so at tier 1 every
   upheld dispute is fully collectable. One constant, **72 h**, bounds both sides: bond cannot leave
   while a completed order is younger than that, and a completed order can no longer be disputed
   once it is older. An append-only ledger (`merchant_bond_events`) is written in the same statement
   as every `bond_usdc` mutation; `bond_usdc = Σ events` is asserted by `check-bond`. Exit is a
   flag (`suspend_reason='exited'`, frozen by trigger), never a delete. A withdrawal is released by
   a root admin who sends the USDC by hand from a cold treasury and records the signature.
6. **Three cold public keys, one hot key that holds gas.**

| Key | Holds | Signs | Lives | Leak = |
|---|---|---|---|---|
| Fee-payer (hot) | SOL gas | deposit sponsor; escrow release/refund authority | Railway `STAGE_FEE_PAYER_SECRET_KEY` | every live vault (bounded by pilot volume) |
| Stake treasury (cold) | all partner bond | nothing | `STAGE_STAKE_TREASURY_ADDRESS`, key offline | nothing from a server breach |
| Earnings (cold) | fees | nothing | `STAGE_PLATFORM_FEE_DESTINATION`, written into each escrow as `platform` | nothing from a server breach |
| Program upgrade authority | — | upgrades | the laptop key `CCxs…a7mq`, never CI | can rewrite release logic |

**Recorded invariant crossed, on purpose.** Project invariant 8 — _no real payout before a real
KYC/AML vendor, sanctions and counsel sign-off_ — is not bent here, it is inverted, and written
down the way [14](14-manual-onboarding-fallback.md) wrote its own exception. The framing that keeps
it honest: closed, allowlisted (the five live invite codes revoked), capped (partner float $100,
tier-1 caps $100/tx, $300/day), the founder on both legs and the payee. **The first stranger's
$200 bond is where this framing stops being true** — see *Before a third party* below.

## What was rejected, and its strongest case

- **Pay the partner directly, skip the program.** Zero SOL, works today. For two accounts that are
  both Bridge, escrow protects nobody from anybody. Rejected: the moment a second person is on either
  leg the partner is bound by a database row and refund is a human promise — invariant 11 exists
  against exactly that — and every line written for it is deleted the week the program ships.
- **Reuse `transfers` + `merchant_stake_withdrawals`, no ledger table.** Deposits really are already
  recorded. Rejected: penalties wrote no row anywhere and there was no single Σ; a two-wallet split
  without a reconcilable ledger is decoration.
- **Automate withdrawals with a treasury signer.** The console promises "usually within a day";
  automation keeps that without a human. Rejected for the pilot: one partner, one admin, and a hot
  key that can drain every bond in one transaction. Multisig custody first.
- **Move the fee to an earnings account at deposit.** One env var. Rejected: the fee lands where
  nothing signs, so refunds silently under-refund by the fee.
- **A new `'exited'` status value.** Rejected by the code: `setMerchantOnlineSelf`'s predicate is
  `status <> 'suspended'`, so a new value would let an exited partner go back online, and three
  different writers touch `merchants.status` — the freeze belongs in a trigger every writer passes.

## The numbers

| Constant | Was | Now | Why |
|---|---|---|---|
| `MIN_BOND` | $2,000 | **$100** | equals tier-1 `sendPerTx`: a floor-bonded partner covers any single order they can be routed |
| `LEVERAGE` | {1:3, 2:5, 3:8} | **{1:1, 2:3, 3:5}** | tier-1 in flight ≤ bond |
| `DISPUTE_PENALTY_USDC` | $1,500 flat | **min(bond, order amount)** | order-sized, bond-bounded, always collectable at tier 1; ledgered as what was actually drawn |
| `DISPUTE_CLAW_WINDOW_H` | — | **72 h** | bond stays claimable, and the order stays disputable, for the same window |
| `MAX_STAKE_DEPOSIT_USD` | $50,000 | unchanged | a typo guard |

At $2,000 the bond did three jobs on one number — access price, loss cover, exposure cap — that
only cohered because the number was large. At $100–300 they don't, unless leverage is 1× and the
penalty is the order.

## The runbook

**Partner:** web signup → deposit real USDC → LP `/apply` (UPI, treasury address, phone) →
`/details` (the About-you form; PAN is hidden since 2026-09-03) → **admin approves** → pay **$100** USDC to the stake
address from any wallet, paste the signature on `/stake`, **admin credits**, the confirmer's chain check
lands it ([20](20-stake-claims.md); or straight from the fpay wallet when it holds USDC) → float $100 → online → keep the console open (3 s poll; no Telegram yet).
**Payer:** deposit real USDC → scan Bridge's own UPI QR → amount → quote → sign the escrow deposit.
Partner locks → pays fiat → marks paid → 2-minute window → release: the partner receives
`amount − fee`, the earnings wallet the fee, the fee-payer nothing.
**Order zero is a refund, not a release:** fund a $1 order, let the 10-minute claim SLA lapse, watch
the full amount come back and the order go `refunded` only after the tx confirms. Then a $50
withdrawal → recorded as sent → `check-bond` reconciles. Then exit → the whole bond comes back →
"You've left".

**Bridge's hands, in order:** new program keypair (`solana-keygen new -o
anchor/target/deploy/escrow-keypair.json`, `anchor keys sync`, **back it up**) → `CARGO_NET_OFFLINE=true
anchor build` → `anchor test` → fund `CCxs…a7mq` with ~2.5 SOL on mainnet → `anchor deploy
--provider.cluster mainnet` → two cold wallets (stake treasury, earnings) → Railway:
`STAGE_ESCROW_PROGRAM_ID`, `STAGE_STAKE_TREASURY_ADDRESS`, `STAGE_PLATFORM_FEE_DESTINATION`, a Helius
`STAGE_SOLANA_RPC_URL`, `STAGE_ADMIN_EMAILS` = one address, fee-payer ≥ 0.1 SOL →
`yarn db:migrate` (0024) → revoke the five live invite codes → push.

## Before a third party is on either leg (owed, not done)

Sanctions screening and a `counterparty` on the order path (`orderMachine.ts` `scoreAndRecord`
records neither); a lock TTL that survives a real bank OTP, with re-lock; the false-"paid"
auto-release with no post-release dispute; escrow PDAs seeded by order id rather than a 32-bit
reference; multisig (Squads) stake custody and an on-chain reconciler for release signatures;
Telegram alerts so a partner is not a polling tab; re-application after exit; per-corridor retention
of PAN/NIK after exit (counsel); paying the payer from the bond on an upheld post-completion dispute
(today it only fines). And counsel's questions, unchanged: whether India permits any live INR
settlement through a personal account at any size, whether the founder controlling both accounts
changes the characterisation or only the harm, whether Indonesia is the safer first corridor.

## Verification record

**Round 1 (escrow half), 6 lenses, divergence 0.88.** Claims: C1 new program id — survived 3-0. C2
`authority: Signer` is free — survived 2-1 (web3.js OR-merges duplicate-pubkey account metas at
compile time, so the authority is flagged signer regardless of the IDL). C3 a dropped `fund-submit`
strands the payer — survived 3-0, strengthened. C4 broadcast ≠ landed — survived 3-0 for refund,
corrected for release (parked in `funds_released`, never re-selected). Grounding 17/22 verified,
5 corrected, 1 strike withdrawn.

**Round 2 (bond half), 6 lenses, divergence 0.77.** All four claims refuted on first reading;
each refutation grounded before acting. N1 exit-as-flag — the bare `setMerchantStatus`, then a
third writer (`decideMerchantKyb`) → the trigger. N2 fee split — one refutation was itself wrong
(`groupId: i === 0 ? null : primaryId`: the primary leg already gets its fee), the other attacked
code the plan deletes. N3 verify-before-flip — placement (`creditStakeOnConfirm` lives in the
`AndNotify` wrapper) and multi-leg `escrow_fund` rows → the check gates the flip; vaults are read,
not parsed. N4 tier-1 collateral — `orders.completed_at` does not exist (→ `order_events`) and
post-completion disputes were unbounded (→ the same constant bounds both sides). Grounding 18/23
verified, 5 corrected, 0 struck.

> Cross-tier verification reduces instance-/tier-level error correlation but not shared-lineage
> blind spots. Treat cross-tier survival as weaker evidence than grounding.

## Telemetry
- divergence: round 1 0.88 (evidence 0.94, conclusion 0.80) · round 2 0.77 (evidence 0.88, conclusion 0.60) | threshold 0.30 UNCALIBRATED
- models: draft=opus · skeptics=2x-opus+1x-sonnet per round (cross-tier; version axis unavailable)
- claims: C1 grounded · C2 cross-tier-survived · C3 grounded · C4 grounded · N1 grounded-after-fix · N2 grounded-after-correction · N3 grounded-after-fix · N4 grounded-after-fix
- grounding: round 1 17/22 verified, 5 corrected, 1 strike withdrawn · round 2 18/23 verified, 5 corrected, 0 struck
- fleet: 6 + 6 lenses, 2 grounding verifiers, 6 skeptics; loop stopped at 2 rounds
