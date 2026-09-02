# 19 · Trips, circles and bill splitting — the decision (2026-09-02)

Plan: `~/.claude/plans/we-are-missing-the-distributed-bumblebee.md`. Product doc: [04 §Flow — trips,
circles and splitting](04-p2p-and-contacts.md). Schema: [09](09-data-model.md).

## What Bridge asked

"We are missing the trip or friends creation and easily bill splitting feature… that feature seems
half baked." Seven pointers: create a trip / circle; split a bill easily; move a transaction between
trips or to personal; Activity shows every transaction with its parts and can show only "my part";
inside a trip, total + my part; personal Activity can filter trips out, and unfiltered reads "paid
100, your part 20"; receiving must not double-count a reimbursement once the expense was reduced to
my part.

## What was there

Nothing. "Trip balance" on Activity was a label on the wallet balance (the card's own comment said
`trip summary`); the Payments/Friends filters tested a kind no real row has (scan-and-pay debits are
`escrow_fund`); `group_id` on `orders` is LP routing legs. Two explorers over 25 migrations, every
route, the contract, the store and both activity screens: no groups table, no shares, no route, no
DTO, no store state, no screen.

## Recommendation (shipped)

**Shares are payment requests.** 0026 adds `groups`, `group_members`, `transfers.group_id`,
`payment_requests.split_of` and a partial unique index on `payment_requests.transfer_id`. A split of
expense T is one request per friend (requester = T's payer, `split_of = T.id`). The payer's own part
is DERIVED — `amount − Σ shares(open|paid)` — never stored. Settling a share is the existing
pay-request flow, untouched. The expense rule: an OUT row counts at your part, an IN row never — so
a reimbursement contributes 0 and there is no dedup table. Exception: a refunded scan-and-pay is 0.
The trip view is a shared sheet; splitting and moving happen from a row's detail and inside the trip.

**Why.** Every guarantee a share needs already lived on `payment_requests` (lifecycle, payer-scoped
settle CAS, transfer link, the Requests UI, the paid notification); a shares table would re-implement
all four. Deriving the payer's part puts over-splitting in one place (the split transaction's sum
check under `FOR UPDATE`) instead of a stored number that drifts on cancel. "IN never counts" is one
predicate and is exactly pointer 7.

## Steelman of what was rejected

- **A dedicated `transfer_shares` table.** A share is not semantically a request; N rows per dinner
  land in Requests; the note doubles as the label; non-fpay members become possible. Passed: Requests
  shows OPEN rows only, which is the right "you still owe" list; the note IS the label; non-users are
  not in the ask (contacts sync is deliberately unbuilt); A re-implements settle/lifecycle/link/notify.
  Falsifier: Bridge wants non-user members.
- **Tags instead of groups.** Fails pointer 5 — a member who paid nothing has no row to see the trip
  through — and pointer 1 has no roster to create.
- **A server-side spend aggregate.** Correct at any length; passed because the client holds one page
  and no pager. Falsifier: paging ships.
- **A "Your share" toggle swapping row amounts** (the literal words). Bridge chose caption + totals.

## Found on the way, fixed here

1. `TxCard` derived the sign from the kind: a send you RECEIVED printed a minus.
2. `markRequestPaid` never verified the transfer id the client posted — any id marked any debt paid.
   Now: the payer's, to the requester, unfailed, ≥ the amount, unused (index + predicate).
3. `POST /requests` with an unknown handle wrote a request addressed to nobody. Now 404.
4. Scan-and-pay rows were titled with the escrow pool's address; the payee name was one join away.
5. The detail page showed a hardcoded date, "Apple Pay" and "#577665".

## Decisions (Bridge, 2026-09-02)

Caption + totals, not a toggle · Spent = this month over the loaded page · one entity, no archive ·
split from detail and inside the trip only.

## Assumptions & falsifiers

Members are fpay users by handle · Activity is cash-basis, the trip sheet accrual · no netting · one
page is enough for Spent · no archive. Each has its falsifier in the plan file.

## Open (for prism-retro)

The two-phase pay (send, then mark paid) is pre-existing and non-atomic — a dropped second call
leaves money moved and the share open. `Txn.rupees` is INR-only, so an IDR scan-and-pay detail shows
dollars. A friend paid before the split exists is a double-ask unless the payer ticks "already
paid". Stage walkthrough (docs/04 §Status) not yet run; 0026 is Bridge's to apply.

## Changelog

Draft v1 held under the orchestrator's three lens passes (the fleet died on a 429). Two claims
corrected by source: the request→transfer link is `payment_requests.transfer_id` only, and a refund
is an IN `escrow_release` row (→ the refunded-is-0 exception). Four pre-existing holes promoted into
scope. Open risk not closed: the non-atomic two-phase pay.

## Telemetry
- divergence: evidence ≈ 1.0 by construction (three disjoint orchestrator file sets: backend / frontend /
  model+docs) · conclusion n/a (single judge) | threshold 0.30 UNCALIBRATED — no independent lenses ran
- models: draft=fable · lenses: 2× Explore completed; 3× Explore + 1× Plan FAILED (429 session limit);
  skeptic trio NOT RUN (plan mode). Version axis unavailable.
- claims: C1 feature-absent grounded · C2 TxCard-sign grounded · C3 request-pay-unverified grounded ·
  C4 request_id-never-written grounded · C5 escrow_fund-is-the-activity-row grounded · C6 refund-is-IN-row
  grounded · C7 PeopleSearch-not-exported grounded · C8 payee-name-one-join-away grounded ·
  C9 client-holds-one-page grounded
- grounding: 31 anchors re-opened, 0 struck, 2 corrected
- fleet: 2 of 6 lenses completed; loop stopped after round 1
