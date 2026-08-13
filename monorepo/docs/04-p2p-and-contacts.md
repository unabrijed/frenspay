# 04 · P2P, contacts & the home screen

## What it is

The Venmo/Cash App core: **send money by `@handle`, phone number, or wallet address**, and
**request money**. Sends are real on-chain USDC transfers, gas-sponsored so they feel instant and
free. Requests are lightweight DB records that link to the transfer that fulfils them. Around it,
the **minimal home** (decided 2026-08-13): **Add and Send. Nothing else.**

**Who you can pay** — every target kind funnels into the same
resolve → **verified payee name** → confirm → send flow (the UPI anti-wrong-send model):

- **`@handle`** — exact directory match (canonical, case-insensitive input).
- **Phone number** — opt-in directory alias; `+`-prefixed input resolves directly, local-format
  input defaults to the sender's country dialing code (`98765 43210` in India → `+91…`), including
  `tel:` QRs and bare printed numbers. Unknown country → the UI asks for the `+code`, never guesses.
- **Wallet address** — external send (tier-2 KYC gated; Solana executes, EVM-family addresses get
  the honest "coming soon" network sheet). The only place chain names appear besides on/off-ramp.
  **This is also the app's "withdraw"**: moving USDC to your own external wallet is an ordinary
  send — there is deliberately no separate Withdraw flow (decided 2026-08-13, "covered by send").
  Fiat cash-out to a bank/UPI is roadmap ([10-ops-and-roadmap](10-ops-and-roadmap.md)).
- **Someone not on the app** — future phase: pay a phone number and the money lands in the UPI ID
  linked to that number (needs the licensed payout rails —
  [06-offramp-and-settlement](06-offramp-and-settlement.md) / roadmap). Today the answer is the
  invite loop: share a code, they join, then it's an internal transfer.

## Flow — send money

```mermaid
sequenceDiagram
    participant U as Sender
    participant API as Backend
    participant CH as Solana
    participant CF as Confirmer

    U->>API: POST /transfer/prepare { toHandle | toAddress, amountUsd, note, idempotencyKey }
    API->>API: resolve target → recipient wallet (verified name back)
    API->>API: limits + screening + risk score (inline, per-route)
    API->>API: buildUsdcTransfer (fee-payer sponsors · creates recipient ATA if needed)
    API->>API: createPendingTransfer (kind='send', status=pending)
    API-->>U: { unsignedTx, feePayer, transferId }
    U->>U: sign (Privy)
    U->>CH: broadcast
    U->>API: POST /transfer/submit { transferId, signature }
    API->>API: attachTransferSignature (owner-scoped, still pending)
    CF->>CH: poll (8s) → confirmed
    CF->>API: setTransferStatus → confirmed
```

The two-call shape (`prepare` → `submit`) is the universal seam from
[01-architecture](01-architecture.md): the backend records *intent* at prepare, so submit only
needs id + signature. Prepare is idempotent (unsigned row → same transfer rebuilt; signed → 409),
which is what makes the client's blockhash-expiry retry safe. Compliance controls are **inline in
the prepare handler**, not middleware — any new money-moving route must re-attach them explicitly.

## Flow — request money

A request is a row in `payment_requests` ("you owe me $X" — a message, not held funds, so no
escrow). Paying it is an ordinary send; `POST /requests/:id/pay` links the fulfilling `transferId`
and marks it `paid`; the requester can cancel while open. Known accepted limitation: the payee
handle is resolved at pay time, so an admin rename between request creation and payment briefly
points at the old handle (self-corrects within one 12s refresh —
[07-admin-and-moderation](07-admin-and-moderation.md)).

## Contacts — "Send to Contacts"

The pieces exist; the home-action wiring is the gap:

- ✅ **Directory resolve** — `GET /users/resolve?handle=|phone=` (authed, rate-limited), consent
  model in [02-identity-and-onboarding](02-identity-and-onboarding.md).
- ✅ **PeopleSearch** (`apps/web/src/components/sheets/friends.tsx`) — one search box accepting
  name / `@handle` / phone / pasted address, debounce-resolving with the verified name shown.
- ✅ **Device contact picker** (`apps/web/src/lib/contacts.ts`) — Web Contact Picker API,
  Android-Chrome only, graceful no-op elsewhere; a picked contact's number prefills the search.
- ⬜ **"Send to Contacts" as THE home action** (decided 2026-08-13) — the Send entry leads with
  contacts/directory rather than a bare search box. Native contact-list sync is a mobile-phase
  item; on web the picker + directory is the honest maximum.

## The home screen ⬜ decided 2026-08-13, gap to close

Today's home grid is Scan / Send / Request / Add (`apps/web/src/app/(tabs)/home/page.tsx`), plus
the bottom nav's center Scan button. Decided: the grid becomes **Add · Send** — Scan and Request
leave the grid ("Rest UI doesn't need other unnecessary items"). Scan stays reachable from the
bottom nav; Request stays reachable inside the social surfaces (a request is still payable). The
balance hero above the grid follows the dual-currency + eye-hide spec in
[05-fees-fx-and-display](05-fees-fx-and-display.md).

## Why this way

- **Handles + server-side resolution.** The sender types a name; the backend resolves the wallet
  and sponsors the recipient's token account (ATA) on first receive — the recipient needs nothing
  set up.
- **Record-intent-first.** A dropped signature leaves a clean, expirable row (the confirmer retires
  stale unsigned transfers), never a lost payment.
- **No separate Withdraw.** One send primitive with one set of guards beats two flows that move
  money the same way — and "withdraw" framing invites fiat expectations the rails don't meet yet.
- **P2P sends are free** — no conversion happens, so no fee exists
  ([05-fees-fx-and-display](05-fees-fx-and-display.md)). Free P2P is a growth feature, not a loss.

## Legalities

- **Self-custodial sends are the user moving their own money** — not the platform transmitting on
  their behalf; the lighter classification
  ([03-custody-money-in-and-confirmation](03-custody-money-in-and-confirmation.md)).
- **Limits + screening enforced**: tier-1 caps (~$100/tx + rolling daily, aggregated over
  `kind='send'`), sanctions/denylist screening on recipients, risk scoring; external sends add the
  tier-2 gate, $1 minimum, and a new-recipients/day cap (fee-payer ATA-rent drain guard).
- **AML / travel rule** at real scale reads the `transfers` ledger — the data foundation is already
  the ledger's job ([08-compliance-and-legalities](08-compliance-and-legalities.md)).

## Status

- ✅ Send by handle / phone / address (prepare+submit, sponsorship, ATA auto-create, idempotent
  prepare, verified-name confirm), requests (create/pay/cancel), limits + screening, confirmation
  via poller/webhook.
- ✅ Contacts building blocks (directory, PeopleSearch, Android-Chrome picker).
- ⬜ Home grid → Add · Send (decided 2026-08-13). ⬜ "Send to Contacts" as the leading Send entry.
- 🟡 Mobile (Expo) parks with P2P-only parity and lags web.

## Key files

- Backend: `apps/backend/src/routes/money.ts` (`/transfer/prepare`, `/transfer/submit`,
  `/requests*`), `routes/auth.ts` (`/users/resolve`), `services/solana.ts` (`buildUsdcTransfer`),
  `db/queries.ts` (`createPendingTransfer`, `attachTransferSignature`, `markRequestPaid`).
- Web: `src/components/sheets/friends.tsx` (Send/Request + PeopleSearch), `src/lib/contacts.ts`,
  `src/app/(tabs)/home/page.tsx`, `src/components/BottomNav.tsx`,
  `packages/shared/src/payTarget.ts` (QR/target parsing).
- Schema: `transfers`, `payment_requests` — [09-data-model](09-data-model.md).
