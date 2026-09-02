# 20 · Stake by paying the treasury directly — a chain-checked, admin-attributed claim

_Decision doc, 2026-09-02. Produced by a prism-plan run (3 differential lenses, 2 critic rounds, ~150
anchors re-opened; the verification record and telemetry are at the end). Companion to
[11](11-lp-console.md) (the console), [15](15-pilot-escrow-and-bond.md) (the bond system) and
[07](07-admin-and-moderation.md) (the admin verbs). Plan: `~/.claude/plans/staking-part-is-missing-federated-crab.md`._

## The problem

A partner could not reach the $100 stake floor, so no partner could go online. `/stake` only signed a
USDC transfer **out of the partner's fpay wallet**, the button was disabled whenever the amount exceeded
that balance, and the console has no way to put USDC into that wallet. An empty wallet meant every
keypad amount was dead, with no message. Bridge: "staking part is missing… on staking just mention that
you have to pay to this (our receive address) and you submit the transaction hash… we will verify and
the admin internally marks if verified… plus ask for their telegram… if duplicate, flag it so admin knows."

## What was decided

**A stake claim is intake plus a human attribution; the money is still recorded, verified and credited by
the existing `transfers` → confirmer → `creditStakeOnConfirm` path.** Admin never types an amount and
cannot credit anything the chain does not show; the chain never decides *whose* bond an unattributed
deposit is.

1. **The partner pastes only the signature.** `POST /merchants/stake/claims { signature }` reads the tx
   off the chain at submit (`readStakeDeposit`, `services/transferVerify.ts`): landed, exactly one
   spl-token transfer into the treasury's USDC ATA (the other legs of a batched exchange withdrawal are
   ignored), its amount, sender (`authority` or a multisig's `multisigAuthority`), memo, block time. That
   is the claim. **The amount is never typed**, so an honest typo can never burn a real deposit as
   `failed`, and an over-claim is impossible. Not landed → 409 `transaction_not_found`; failed → 400
   `transaction_failed`; nothing into the treasury → 400 `not_a_stake_payment`; two deposits in one tx →
   400 `shared_transaction`. Refused claims are not stored — there is nothing to adjudicate.
2. **Admin credits; the confirmer verifies and lands it.** `POST /admin/stake/claims/:id/credit` inserts
   a **pending** `transfers` row — `from_user_id` the partner, `from_address` NULL, amount what the chain
   said, the signature — and marks the claim `accepted`, in one transaction, with an `admin_actions` row.
   The existing confirmer asks the chain before the flip (invariant 33) and `creditStakeOnConfirm` credits
   bond + ledger in one statement (35). Any console admin may credit: the chain decides the money, the
   admin decides only whose. `reject { note }` is the other verb; the partner reads the note.
3. **Duplicates are rows, not 409s.** Two unique indexes on `merchant_stake_claims` (0027): one claim per
   partner per signature, ever (bounds re-submission with no rate limiter, and lets admin flip one row);
   one **live** claim (`submitted`/`accepted`) per signature — a **rejected** claim releases it. A second
   submission is stored as `duplicate`, pointing at the first (or at the `transfers` row that already
   holds the signature, when it came through the in-wallet path), and the admin list shows both with
   "also claimed by @x". Credit works from any status but `accepted`; the indexes refuse it while anything
   else still holds the signature. The treasury address is public and the first to paste is not
   necessarily the one who paid — this is the whole reason for a human step.
4. **The verifier skips the sender only when the row asserts none.** `instructionsMove` takes
   `authority?`; a `transfers` row with `from_address` NULL is pinned by amount + destination + the unique
   signature + the admin's recorded attribution. Every other writer sets a sender and is still held to it.
5. **The shared writer is closed.** `attachTransferSignature` matches the same signature or an unsigned
   pending row — never re-points a signed row. Before, a confirmed stake row's signature could be
   overwritten (freeing it from the unique index) and re-attached to a fresh pending row the verifier
   would confirm again: a double credit of one deposit, owner-only, live. `status = 'pending'` alone was
   the wrong guard: the Helius webhook attaches an escrow deposit by memo first and the payer's late
   fund-submit re-sends the same signature and must match. `/transfer/submit` validates base58.
6. **Telegram is required** on the About-you form (`contactTelegram`, shared spec + backend mirror;
   `check-kyb` asserts the mirror both ways now). It already rendered in the form and in admin.
7. **The refund address is the partner's to give.** Withdraw and exit take `payoutAddress` (blank = the
   fpay wallet, resolved at release time); stored on the request (`merchant_stake_withdrawals.payout_address`);
   changeable while open (`POST /merchants/stake/withdraw/:id/address`) because an exit cannot be
   cancelled. Validated as a plain send's recipient is — on-curve owner, not one of ours
   (`isValidRecipientOwner` + `isOperationalAddress`).
8. **The screens.** LP `/stake`: the address (tap to copy), the ID field, "Submit for checking", the
   partner's claims in their own words (*Being checked · Confirming · Added to your stake · Didn't check
   out · Not accepted: why · Already used*), a 10 s poll while anything is pending, and "Or stake from
   your fpay balance" only when that wallet holds anything. Admin Merchants: a "Stake deposits to check"
   table — who, amount seen, sender, paid, Solscan link, status, rival claimants — with Credit / Reject.

## What was rejected, and its strongest case

- **Insert the `transfers` row at submit and auto-credit.** Zero schema; the confirmer already does
  everything; the unique index already refuses duplicates. Rejected: the treasury address is public, the
  409 is invisible to admin, the sender is unknown, a typed amount burns typos, and Bridge asked for a
  human mark.
- **Require a per-partner memo and auto-credit on match.** It is how the escrow pool solved the identical
  attribution problem (invariant 41), and the code exists. Rejected *for now*: exchange withdrawals cannot
  carry memos, so it is a second lane on top of the admin one. The memo is stored and shown; the screen
  suggests it; an auto-lane can be added with no migration.
- **Delete the in-wallet stake path.** Two paths, and the signer lives in the LP bundle only for this.
  Bridge kept it: it is the one path whose attribution is automatic, and his own account is funded through
  the payer app (same Privy app, same wallet).
- **Duplicates as `risk_events` only.** The risk page exists. Rejected: adjudication happens on the stake
  list; a flag on another page is a cross-reference nobody makes.
- Four of the draft's own remedies fell to the critics and were replaced: `status <> 'duplicate'` as the
  unique predicate (a rejected impostor would lock the owner out forever); `status = 'pending'` in the
  attach guard (breaks the webhook-first escrow path); `new PublicKey()` as the refund validator (a token
  account passes it); "exactly one transfer in the tx" (a batched exchange withdrawal has many).

## Ceiling named, not solved

Two partners withdrawing from the same exchange in the same batch can land in **one** tx with two
transfers to the treasury. `transfers.signature` is unique — the money model is one row per signature —
so neither can be credited through this design. The claim is refused with `shared_transaction` ("contact
us and we'll sort it by hand"); the ledger's `adjust` kind exists for the by-hand answer, unrouted. Rare
at pilot scale and visible when it happens; if it recurs, the fix is a per-instruction transfer row.

Also unchanged and pre-existing: both the submit-time read and the confirmer's read use
`commitment: 'confirmed'`, not finalized.

## How a partner stakes now

Send USDC on Solana to the stake address shown on `/stake` (from an exchange, another wallet — anywhere)
→ paste the transaction ID → "Being checked" → admin sees amount, sender, Solscan, any rival claim →
**Credit** → the confirmer verifies within a tick → "Added to your stake" → the floor is met → they go
online themselves. Getting it back: "Take some back" or "Leave" asks which wallet, prefilled with the fpay
wallet; a root admin sends by hand and records the signature, as before.

**Bridge's hands:** `yarn db:migrate` (0027) on stage; the stage test in the plan's verification section
(a $1 deposit from a non-embedded wallet, the same signature twice, a signature that pays someone else,
a rejection, a withdrawal to a typed address); push on ack.

## Regulatory note

The treasury now receives USDC from addresses fpay never screens. Within the closed pilot
([15](15-pilot-escrow-and-bond.md): allowlisted, capped, the founder on both legs) this is tolerable and
the claims table is the audit trail — who claimed which deposit, who attributed it, when. Before a
stranger stakes: sender-address screening and a source-of-funds question join the counsel list in 15
§Before a third party.

## Verification record

**Fan-out (3 Explore lenses, differential file sets: backend/DB · frontends · adversary).** DIVERGENCE
0.75 (evidence 0.80, conclusion 0.67). Consensus: the dead end is real; duplicates are a swallowed 409;
the verifier needs the sender; admin has no tx view; Telegram already exists. Contradictions: auto-credit
vs admin lane (admin lane won on the public address + invariant 41's lesson); body amount vs chain amount
(chain won: a typo burns a deposit as `failed`, unrecoverable under the status gate). Unique: the
adversary's live double-credit via `attachTransferSignature`.

**Round 1 critic (8 claims).** C1 confirmer-picks-pre-signed-rows SURVIVED (+ type fix) · C2
only-NULL-rows-relax SURVIVED · C3 `<> 'duplicate'` index REFUTED → live-status index + credit-on-
non-accepted · C4 `status='pending'` guard REFUTED → same-signature-or-unsigned-pending · C5 reader
CORRECTED (treasury-ATA scope, multisig sender, commitment ceiling) · C6 check-kyb REFUTED → count,
ID fixture, reverse mirror · C7 address-disclosure SURVIVED · C8 → poll, failed badge, cap declined.

**Round 2 critic (5 new claims).** N1 index CORRECTED (queue lists duplicates; one row per partner) ·
N2 guard SURVIVED (+ the LP's 15-minute 404 rerouted into the claim flow) · N3 refund address REFUTED
on validator → `isValidRecipientOwner` + operational set; exit-typo dead end → edit route; stale copy;
its "`uq_stake_withdrawal_open` does not exist" was itself wrong (0014:93) · N4 "exactly one" REFUTED
→ named ceiling + own code; commitment pinned · N5 poll CORRECTED.

**Found during implementation:** a concurrent session had taken migration 0026 and docs/19 between
this plan's first read and its first commit; the migrator keys applied rows by numeric version, so two
0026 files would have been one applied and one silently skipped. Renamed to 0027 / docs/20.

> Cross-tier verification reduces instance-/tier-level error correlation but not shared-lineage
> blind spots. Treat cross-tier survival as weaker evidence than grounding.

## Telemetry
- divergence: 0.75 (evidence 0.80, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=fable · lenses=3× Explore (opus) + 2× Plan critic (opus); skeptic trio NOT RUN (plan
  mode) — every load-bearing claim grounded by re-opening source, which outranks cross-tier survival;
  version axis unavailable
- claims: C1 grounded · C2 grounded · C3 REFUTED → corrected · C4 REFUTED → corrected · C5 corrected ·
  C6 REFUTED → corrected · C7 grounded · C8 corrected · N1 corrected · N2 grounded · N3 REFUTED →
  corrected (one skeptic citation struck by grounding) · N4 REFUTED → ceiling named · N5 corrected
- grounding: ~55 anchors re-opened by the orchestrator, ~100 by the two critics; 0 struck for being wrong
  about current code, 1 skeptic refutation struck, 6 draft remedies refuted and replaced
- fleet: 3 lenses + 2 critics; loop stopped after round 2
- shipped: 9 commits on `stage` (`44a45a6` `6fdb1b6` `fd38b26` `67d17dd` `a1aa576` `47219f8` `de3469e`
  `a1097d6` + docs), `check:verify` +11, `check:kyb` reverse mirror; unpushed
