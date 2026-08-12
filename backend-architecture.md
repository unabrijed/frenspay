# Backend Architecture: Wallet, P2P, and the Licensed Settlement Layer

This is the backend structure for the licensed model. Phase 1 is the wallet and P2P layer we are
building now. Phase 2 is the settlement and treasury layer that lets a foreign traveler pay an Indian
merchant in INR, funded by a licensed partner. Phase 2 is gated on legal clearance and a signed
USDC-to-INR conversion partner, so it is designed now and built when that partner is real.

---

## 0. The core model: two clocks, never collapsed

Spend clock, real time, seconds. The user authorizes a payment. The merchant is paid in INR instantly
from a pre-funded INR float held by the licensed partner. The user's USDC is debited against that
float at an FX rate locked at authorization. Nothing in the user's payment path waits on a blockchain
confirmation or a cross-border conversion.

Treasury clock, batched, minutes to hours. User balances and the company treasury sit in USDC. The
USDC pool replenishes the INR float in bulk. The actual USDC-to-INR conversion happens here, at the
pool level, executed by the licensed partner, not per user spend. TDS and PMLA reporting land once,
here, on the licensed conversion entity.

Three custody layers, so it is clear who holds funds at each hop:
- User layer: USDC, self-custodial, we are not a deposit holder.
- Spend layer: a pre-funded INR float held inside the licensed partner, not on our books.
- Treasury layer: the USDC pool, where batched conversion is executed by the licensed partner.

---

## 1. Stack (unchanged from the wallet decision)

- Chain: Solana. Native USDC, sub-cent fees, our ecosystem.
- Wallet and auth: Privy embedded wallet, passkey login, self-custodial, behind a thin interface.
- RPC and indexing: Helius (RPC plus transfer webhooks).
- Backend: Railway — a Fastify (TypeScript) API service; the database is Supabase Postgres (session pooler). Realtime via WebSocket/SSE or polling; access control is enforced in the API layer (no RLS). The services below run as part of (or alongside) this service.
- Token: Circle's native USDC SPL mint on Solana.

---

## 2. Services

Phase 1, building now:
- Wallet service. Privy onboarding, passkey, Solana wallet creation, recovery path.
- Fee-payer service. A backend-held Solana keypair that sponsors network fees and ATA rent. Users
  never hold SOL.
- Indexer. Helius webhooks to confirm USDC transfers, written to the transfers table.
- Core API (Fastify service on Railway). auth/sync, me, balance, transfer/prepare, transfer/submit,
  users/resolve, requests, transactions.

Phase 2, designed now, built on a signed partner:
- Settlement service. The real implementation of the SettlementProvider seam. quoteSpend locks a
  rate at authorization; executeSpend debits the user's USDC to the treasury and instructs the
  licensed partner to pay the merchant INR from the float; records the settlement and reconciles
  against the float.
- Treasury service. Monitors each corridor's INR float, triggers batched USDC-to-INR replenishment
  through the licensed partner, manages FX and spread, and feeds the rate oracle used for
  authorization locks. Holds the conversion timing policy (same-day, short holding period) that keeps
  the tax gain base and FX exposure minimal.
- Ledger service. A double-entry internal ledger reconciling the USDC pool, each corridor's INR
  float, user balances, and partner settlement statements.
- KYC and AML service. Onboarding tiers (passkey and lightweight for the crypto layer, passport and
  visa for the PPI), sanctions and risk screening, travel-rule handling, and capture of the January
  2026 FIU fields (live identity, IP, timestamp, geolocation, device ID, wallet address, transaction
  hash).

---

## 3. Data model

Phase 1 tables (as built):
- users: id, privy_did, handle, display_name, email, phone, created_at.
- wallets: id, user_id, chain, address, created_at.
- transfers: id, signature, from_address, to_address, from_user_id, to_user_id, amount_usdc, kind,
  note, status, request_id, created_at, confirmed_at.
- payment_requests: id, from_user_id, to_user_id, amount_usdc, note, status, transfer_id, created_at.

Phase 2 tables (added):
- floats: id, corridor (for example INR), partner_id, balance_local, low_watermark, target_balance,
  updated_at.
- conversions: id, batch_ref, usdc_amount, local_amount, currency, rate, partner_id, tds_amount,
  status, created_at, settled_at. One row per treasury-clock batch. TDS and PMLA reporting attach
  here.
- settlements: id, user_id, merchant_ref, local_amount, currency, usdc_debited, rate_lock_id,
  float_id, status, created_at, settled_at. One row per spend-clock payment.
- fx_rate_locks: id, currency, rate, quoted_at, expires_at, used. Backs quoteSpend.
- ledger_entries: id, account (user_balance, usdc_pool, inr_float, partner_settlement, fees,
  tax_withheld), debit, credit, ref_type, ref_id, created_at. Double-entry.
- kyc_records: id, user_id, tier, status, document_ref, screening_result, created_at, reviewed_at.

Access control is enforced in the API/service layer (the Fastify service authenticates every
request and scopes queries to the caller — no Supabase-style RLS). Treasury, float, conversion, and
ledger tables are service-only and never exposed to client-facing routes.

---

## 4. Spend flow, end to end (Phase 2)

1. User taps to pay a merchant QR. Client calls quoteSpend.
2. Settlement service returns a locked quote: USDC amount, the INR figure, the rate, an expiry.
3. User confirms within the expiry. Client calls executeSpend.
4. Settlement service debits the user's USDC from their wallet to the treasury (on-chain, gas
   sponsored), and instructs the licensed partner to pay the merchant INR from the pre-funded float.
5. The merchant is paid instantly in INR from the float. The user's payment path never waited on a
   conversion.
6. Settlement recorded, ledger entries written, float balance decremented.

The user experience here is faster than the P2P alternative, because the INR is already positioned.
There is no liquidity provider to match and no dynamic-QR race to lose.

---

## 5. Treasury flow (Phase 2)

1. A corridor's INR float drops below its low watermark.
2. Treasury service initiates a batched USDC-to-INR conversion through the licensed partner.
3. The partner converts at the pool level and the INR lands in the float.
4. One conversion row is written. TDS and PMLA reporting attach to this batch, on the licensed
   entity, not on individual user spends.
5. Ledger reconciles the USDC pool, the float, and the partner statement.

---

## 6. Where the regulated boundaries sit

- User funds: self-custodial USDC, never held by us.
- Spend float: held inside the licensed partner, never on our books.
- Conversion: executed by the licensed partner. We orchestrate timing and amounts, we do not perform
  the conversion ourselves.
- This is self-custodial in form. If we later orchestrate spend in a way a regulator views as control
  in substance, we revisit it. Flagged for legal.

---

## 7. Reconciliation and integrity

- Continuous three-way reconciliation: USDC pool versus INR float versus user balances, checked
  against the partner's settlement statements.
- Settlement and conversion operations are idempotent, keyed on signature or batch reference.
- Rate locks expire; an expired lock forces a re-quote rather than settling at a stale rate.
- Optional: a zkTLS proof of the partner's INR payment, as dispute evidence, kept off-chain.

---

## 8. Security and operations

- Fee-payer key in a secret manager or KMS, rotatable, with a SOL balance alert.
- Float financing alerts and automated replenishment triggers, so the spend clock never starves.
- Partner API failure handling: if the partner cannot settle, the spend is declined before the user's
  USDC moves, never after.
- No bank, UPI, or other payment PII on-chain, ever. This is a hard rule, learned from inspecting the
  P2P.me transactions, where bank names and account labels sit in plaintext on a public ledger. Ours
  stays in the backend.

---

## 9. Build sequence

1. Phase 1, now: wallet, P2P USDC, fee-payer, indexer, core API. Self-custodial, no fiat.
2. Phase 2, on a signed partner and legal clearance: make the SettlementProvider real, build the
   treasury, ledger, and KYC services, and integrate the PPI and card spend legs.

---

## 10. Assumptions and open dependencies

- Provider is Privy, chain is Solana, kept behind a thin interface.
- Funding is deposit-only at first, fiat on-ramp later.
- The gating dependency is the licensed USDC-to-INR conversion partner. Phase 2 cannot start until
  this is signed and legal has confirmed the structure (see the legal brief, questions 3, 5, and 6).
- The PPI issuer or sponsor for the spend leg is a separate dependency tracked alongside the
  conversion partner.
