# 16 · The escrow pool, and the program that was audited and shelved

_Decision doc, 2026-08-31. Produced by a prism-plan run (six lenses, two grounding passes, four
skeptics over two rounds; the verification record is at the end). Supersedes the "deploy the
program" step of [15](15-pilot-escrow-and-bond.md); everything else in 15 stands. Companion to
[06](06-offramp-and-settlement.md) (the machine) and [08](08-compliance-and-legalities.md) (custody)._

## What was decided

Bridge, before spending anything on a mainnet deploy: _make sure the program is secure; keep it
simple in gas terms — not $300 for a deployment; audit the contract thoroughly; how does it prove
the user paid on-chain, and that there was no dispute; if that needs an oracle, keep a private key
in the backend and use it to move the money instead._

Three questions hid in that, with different answers:

1. **Is the program safe?** No — not as built. The audit (below) found a CRITICAL dust-lock and a
   HIGH refund-to-anyone, and refuted its own first fix.
2. **What does "paid on-chain" prove?** The USDC leg is a chain fact under either design — a token
   balance anyone can read; no oracle was ever needed. The fiat leg (INR reached a UPI VPA) is not
   on-chain and has no oracle for the LP path; the system answers it with the partner's claim, the
   payer's dispute window and a human, recorded in the DB. Disputes were never on-chain by design.
3. **Is the deploy worth it now?** It is a refundable **~2.07 SOL (≈ $213 at $102.80)** locked as
   rent, with **≈ $2–3 sunk** — not "$300 spent". But with the client as it ships today most of the
   program's advantages over a backend key were shown to be illusory (round 1, V4).

**Bridge chose: "Backend key, program later."** The pilot runs on a **backend-custodied escrow
pool**; the program stays in `anchor/`, undeployed, with its audit record so the next deploy starts
from findings rather than zero.

## Design B — the escrow pool

The payer's USDC goes to **one token account owned by a dedicated escrow key** — never the fee-payer,
never the stake treasury, never the earnings wallet. The backend signs the way out: on release,
`amount − fee` to the partner and `fee` to the earnings wallet in one transaction; on refund, the full
amount back to the payer. The fee-payer pays the gas for every one of those; **the escrow key holds
no SOL**.

Everything already built stays: the chain is still asked what a signature moved before any row flips
([transferVerify.ts](../apps/backend/src/services/transferVerify.ts) — and now for our **own**
settlements too), settlements are still written on landing with one in-flight tx per order
(`settleEscrow`), the bond system is untouched. What is removed is the Anchor client, the vendored
IDL and per-order vault reads. What is lost, and written down, is per-order on-chain segregation and
the PDA-closed double-settle guard. The PDA had been doing two jobs nobody had named — **attribution**
(a seed bound one deposit to one order) and **idempotency** (a closed account cannot pay twice) — and
each is re-implemented explicitly:

| The PDA gave | The pool does instead | Where |
|---|---|---|
| one deposit ↔ one order, by seed | every deposit carries its **order reference as an SPL Memo**; the verifier requires the memo to equal the row's reference, so one transfer verifies exactly one order | `buildUsdcTransfer({ memo })`, `instructionsMove(…, { memo })` |
| a closed account cannot pay twice | a settlement tx is **written off only when older than `SETTLE_DROPPED_MS` (3 min) AND absent from transaction history**; landed-but-unseen ⇒ still in flight, never re-broadcast. Age alone is not a guard; age + "the chain has no record" is, because a blockhash older than ~151 blocks is no longer processed and nothing here uses a durable nonce | `settleEscrow` |
| the vault was the truth for a deposit the DB never saw | **webhook-first recovery**: the fee-payer co-signs every deposit, so Helius pushes every one; an unknown signature is parsed, its memo names the order, the signature is attached, the normal chain check runs. The poller reads the pool's history **only while a signature-less deposit row waits** — zero RPC credits at idle | `attachDepositByMemo`, `reconcilePoolDeposits` |
| our outbound leg was our own signature | `escrow_release` rows are chain-parsed like every other: pool owner as `authority`, the recipient's ATA as `destination`, the exact amount; a release row records the partner as `to_user_id` so a payout the chain contradicts has someone to write a `risk_events` row against | `needsChainCheck`, `releaseToMerchant` |

### Keys and where they live

| Key | Holds | Signs | Lives | Leak = |
|---|---|---|---|---|
| **Escrow** (new, hot) | the pool: every deposit not yet settled | token transfers OUT of the pool. **No SOL while a fee-payer is configured; ~0.05 SOL without one** (it then pays its own gas + new token accounts — §Who pays gas) | `ESCROW_SECRET_KEY` (JSON byte array, the fee-payer's shape). **Stage:** generated on the dev machine, set in Railway's stage env. **Prod:** Bridge generates and sets it himself — [DEPLOY.md §Keys](../DEPLOY.md) | the pool (in-flight deposits) — the same set a leaked program authority could take |
| Fee-payer (hot, **optional**) | SOL gas | tx fees; ATA rent; co-signs every user tx | `FEE_PAYER_SECRET_KEY` — absent ⇒ sponsored mode | gas |
| Stake treasury (cold) | partner bond | nothing | `STAKE_TREASURY_ADDRESS` | nothing from a server breach |
| Earnings (cold) | fees | nothing | `PLATFORM_FEE_DESTINATION` | nothing from a server breach |

**Loss** of the escrow key loses the pool, full stop — no self-refund exists under B. The controls
are the backup Bridge keeps and a pool that is small because settlements are minutes long.

### Who pays gas — two modes, chosen by one variable

Users never hold SOL. Who pays for their transactions is decided at boot by whether
`FEE_PAYER_SECRET_KEY` is usable (`config.feePayerConfigured`), and the prepare response tells the
client which world it is in (`sponsored: boolean`, [`PrepareTransferResponse`](../packages/shared/src/contracts.ts)):

| | **Fee-payer mode** (key configured) | **Sponsored mode** (no key — stage as of 2026-08-31) |
|---|---|---|
| User tx (send, stake, escrow deposit) | our fee-payer is the tx's fee payer and has **already signed** it; it may create the recipient's token account inside the same tx | built with **no backend signature**, the sender as a placeholder fee payer; the web client passes `sponsor: true` and **Privy's fee payer rewrites the fee-payer field + blockhash**, then the user signs. A missing recipient token account is created **first, in a separate tx** paid by the escrow key and awaited — Privy pays the message fee, not a second signer's rent |
| Backend tx (release, refund, account creation) | paid and co-signed by the fee-payer | paid by **the escrow key itself** (`gasKeypair()`), which therefore keeps ~0.05 SOL |
| Helius watch | the pool's token account **and** the fee-payer | the pool's token account (it is in every deposit and every payout) |
| Mobile | works | **not available** — `@privy-io/expo` has no `sponsor` option; the phone app refuses with plain copy and points at the web app |
| Preconditions we cannot check in code | the key holds SOL | Privy dashboard → Gas Sponsorship → Solana **on**; the app's Solana wallets on Privy's **TEE** stack (the SDK refuses otherwise); the escrow key funded |

The two modes never mix inside one transaction: Privy's rewrite would invalidate any signature of
ours. `composeUsdcTransfer` is pure and both shapes are asserted offline by `check-gas-modes`;
`check-escrow-switch` asserts that a missing fee-payer is **sponsored mode, not payments off**.
Privy's own "Sponsoring transactions on Solana" guide describes the fee-payer mode; its native
sponsorship ("a Privy-managed fee payer wallet funded with SOL … updates the transaction's `feePayer`
field and latest blockhash", billed through Privy) is the sponsored mode. Nothing here "handles gas
automatically": the backend selects the mode and the client asks for it.

**`escrowLive`** — payments are a capability, not a tier: `envConfig.ts` derives it as _escrow key
usable ∧ earnings address a valid pubkey_ — the fee-payer is optional and only picks who pays gas
(§Who pays gas) — (shape-checked; a base58 secret, a
placeholder or a 63-byte array all read as off). `/orders/quote` and `POST /orders` answer
`503 payments_unavailable` while it is false, and the boot log names the tier-prefixed variables
actually read. `check-escrow-switch` asserts every branch; `check-transfer-verify` asserts the memo
binding and the outbound-row parse; `check-escrow-pool` (DB + RPC, by hand) asserts _pool balance =
Σ open orders_ within the in-flight tolerance.

### Custody, said plainly

[08 §1](08-compliance-and-legalities.md) now reads: non-custodial at rest but **custodial in flight** — a
payer's USDC is sent to a pooled token account controlled by one platform-held key, from which the
backend pays the partner or returns it. The deleted-account copy that said "never with fpay" was
false mid-order under either design and is rewritten.

## The shelved program — audit record

`anchor/programs/escrow/src/lib.rs` as rebuilt 2026-08-30 (`authority: Signer` at deposit, fee
inside the escrow, `platform_ata` on release; 297,000 bytes). **Not deployed.** Findings, so the next
attempt starts here:

| Sev | Finding | Fix when resumed |
|---|---|---|
| CRITICAL | **dust-lock.** `close_account` requires a zero balance (`spl-token processor.rs:682`, `NonNativeHasBalance`); release/refund move exactly `escrow.amount`; anyone can transfer 1 base unit into a vault → the close fails atomically, forever; references are 32-bit so every open vault is enumerable. Only an upgrade recovers | `vault.reload()` after each CPI (Anchor caches at `try_accounts`), then move the **entire remaining balance** on the final leg — including the `fee == 0` (split) leg, which today has no final transfer to absorb dust |
| HIGH | `Refund.destination` is mint-only → a leaked authority refunds to itself | `constraint = destination.owner == escrow.user` |
| HIGH | upgrade authority = the deploying laptop key; compromise = redeploy = drain every open vault | hardware wallet / multisig before a third party; never `--final` while the upgrade path is the rescue hatch |
| MED | no path out of an open escrow without the recorded authority (lost key = stranded). `update_authority` must be signed by the OLD key, so it cannot fix a *lost* one; a permissionless `refund_expired` is **unsound** with the dispute freeze (`orders.ts` NULLs `expires_at`; a chain clock cannot see it; a payer whose LP paid disputes, waits, self-refunds) | open design question — a settlement authority rotatable by a cold admin key recorded at deploy is the shape to explore |
| MED | `vaultsFunded` read `.amount`, never `.mint` | one line (moot: the reader is deleted) |
| LOW | `rent` sysvar unused in Anchor 0.32; three `#[event]`s with no consumer; `Release.destination.owner != authority` is a free line | delete / add |
| — | client + IDL drift: the backend shipped the OLD shape (`deposit(amount, reference)`, fee split at deposit, fee-return on refund) | regenerate the IDL and rewrite the client before any deploy |

**Economics for the record.** 297,045 B → 2.068 SOL ProgramData rent, refundable via
`solana program close` (which retires the id); the 36-byte Program account (0.0011 SOL) is a
permanent tombstone and `anchor deploy` also uploads an IDL account (~0.02 SOL). Sunk ≈ $2–3 at
SOL $102.80 (2026-08-31). `opt-level` sits under `build-override` in `Cargo.toml`, so the SBF binary
is at cargo's default; ProgramData length is fixed at first deploy, so shrinking later refunds nothing
without closing the id. Per order ≈ 0.004 SOL rent, returned on close. Neither `escrow-keypair.json`
under `anchor/target/deploy/` nor the devnet id `9UfJ…Vv3i` is bound to anything now.

**What the program would still buy, when resumed:** per-order segregation, PDA-closed idempotency,
and a payer's refund that a third party can verify without trusting our attribution. What it would
not buy (with the client as shipped): a smaller blast radius — `authority === feePayer` put fees and
gas in one key already, releases went straight to the partner, and `splTransferMatches` parses our
outbound rows unmodified.

## Runbook delta

Same two accounts, same order as [15](15-pilot-escrow-and-bond.md), with: the payer's deposit lands
in the **pool** (Solscan shows one account — the escrow key's USDC ATA — with the memo on the tx);
**order zero is still a refund** — watch the pool pay the payer back and `check-escrow-pool`
reconcile to zero; then a release — the pool pays the partner `amount − fee` and the earnings wallet
`fee` in one tx. Stage first, with "a little" real USDC; Bridge's own key on prod.

## Verification record

**Round 1 — the program (6 lenses, divergence 0.62: evidence 0.85, conclusion 0.27).** Conclusions
converged on "deploy, with fixes"; evidence sets barely overlapped. Grounding 16/20 verified, 4
corrected, 0 struck. Skeptics 2× Opus: **V1 dust-lock survived 2-0 and its proposed fix was refuted**
(stale `vault.amount`, no final leg at `fee == 0`); **V2 economics refuted on the margins** (tombstone
+ IDL account; `build-override`; fixed ProgramData length; `reconcileFundedVaults` re-read every
`failed` order for 24 h at 8 s — three abandoned orders exhaust the Helius free tier); **V3 proof
refuted in part** (Xendit `check()` IS a vendor oracle for provider corridors; the LP path has none);
**V4 comparison refuted 2-0** (the program's blast-radius advantage was illusory with the shipped
client; `refund_expired` unsound with the dispute freeze).

**Round 2 — the pool (Opus + Sonnet; every B claim refuted on first reading, each refutation
grounded, then absorbed).** Grounding 7/12 verified, 5 corrected, 0 struck. **B1 double payout:** the
write-off leaned on the PDA; a pool never closes → status-checked write-off; 60 s inline wait → 15 s.
**B2 attribution:** one signature could satisfy two same-amount pending rows; release rows carried no
user id → SPL Memo + `to_user_id`. **B3 reconciliation:** a pool scan costs ≥ 1 credit per tick
unconditionally → webhook-first, poll only with candidates. **B4 copy/blast radius:** the pool is not
bounded by LP float — true of the vaults too; the pool ATA is world-writable where deposit was
platform-signed — accepted, mitigated by memo attribution (an unsolicited deposit matches nothing and
`check-escrow-pool` reports it); "never with fpay" rewritten.

> Cross-tier verification reduces instance-/tier-level error correlation but not shared-lineage
> blind spots. Treat cross-tier survival as weaker evidence than grounding.

### Assumptions, with what would falsify them
- **P1** Only the fee account (message index 0) is charged; the escrow key signs as token authority
  and, in fee-payer mode, holds no SOL. Falsifier: a `transferChecked` whose authority is charged —
  none exists.
- **S1** Privy sponsorship accepts a tx whose placeholder fee payer is the sender's own wallet and
  rewrites it. Falsifier: the first sponsored $1 send fails on the fee payer → fall back to fee-payer
  mode (set the key) while asking Privy which placeholder they expect.
- **S2** The app's Solana embedded wallets are on Privy's TEE stack. Falsifier: _"Sponsoring
  transactions is only supported for wallets on the TEE stack"_ → fee-payer mode only.
- **S3** Helius matches the pool's token-account address in `accountAddresses`. Falsifier: no push
  for a deposit → the poller (`reconcilePoolDeposits`) is the backstop; add the owner address too.
- **P2** A tx whose blockhash is older than ~151 blocks is not processed; with no durable nonce, a
  settlement absent from history after 3 min cannot land. Falsifier: any durable-nonce use.
- **P3** Helius pushes every tx the fee-payer signs (`transactionTypes: ['Any']`), so a deposit whose
  `fund-submit` dropped still reaches the webhook. Falsifier: a deposit broadcast without the
  fee-payer's signature — the client always uses the prepared tx; the poller is the backstop.
- **P4** The Memo program's parsed form is `{ program: 'spl-memo', parsed: '<string>' }`. Asserted in
  `check-transfer-verify`'s fixture; confirmed against the first real deposit of the pilot.

### Open risk not closed
Custodial in flight (08 says so). A lost escrow key loses the pool (the backup is the control). The
fee leg to the earnings wallet has no row and is unverified (accepted). A dispute can hold a deposit
in the pool indefinitely. P3/P4 are asserted in code, not proven here.

## Telemetry
- divergence: 0.62 (evidence 0.85, conclusion 0.27) | threshold 0.30 UNCALIBRATED — conclusions converged on the program before Bridge chose otherwise; evidence sets did not
- models: draft=opus · skeptics round 1 = 2x-opus · round 2 = 1x-opus + 1x-sonnet (cross-tier; version axis unavailable)
- claims: V1 grounded · V2 grounded-after-correction · V3 grounded-after-correction · V4 refuted · B1 grounded-after-fix · B2 grounded-after-fix · B3 grounded-after-fix · B4 grounded-after-correction
- grounding: round 1 16/20 verified, 4 corrected, 0 struck · round 2 7/12 verified, 5 corrected, 0 struck
- fleet: 6 lenses + 2 grounding verifiers + 4 skeptics; loop stopped at round 2
