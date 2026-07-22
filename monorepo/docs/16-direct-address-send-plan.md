# Prism Plan: Direct send-to-address with network detection

> Status: FINAL — converged + verified (grounding 23/26, skeptic panel complete), all product questions answered by Bridge 2026-07-02
> Mode: Looped (plan/decision) | Fleet: 8 lenses (high-stakes: moves money)
> Lenses: first-principles · adversary · practitioner · security/threat · regulatory/compliance · data-integrity · UX/flow · simplicity/YAGNI
> Project memory: `.prism/project-model.md` MISSING — reasoned from code directly (run `/prism-understand` to seed it)
> DIVERGENCE: 0.57 (evidence 0.78, conclusion 0.25) | threshold 0.30 UNCALIBRATED — W1 differential context held

## Context

Bridge reports "the payment system is a bit disconfigured" and wants direct sends to wallet addresses (not just saved contacts): user enters an address, the app detects possible networks among Ethereum mainnet, Solana, Arbitrum, Base, Monad, Polygon.

**Bridge's follow-up constraint (2026-07-02):** the end state is **cross-chain sending**, but the asset is **USDC only** — no other token is allowed, and the UI must never mention tokens at all. User-facing amounts are always plain dollars ("$25.00", never "25 USDC"); network names are the only crypto-adjacent concept allowed to surface (unavoidable for cross-chain send safety).

## Product decisions (locked by Bridge, 2026-07-02)
1. **v1 scope:** Solana execute + EVM detect/coming-soon. ✔
2. **KYC gate:** external-address sends require tier 2 (verified); contact sends stay tier 1. ✔
3. **Platform:** web first; shared logic in `packages/shared` so mobile adopts it later. ✔
4. **Asset model:** USDC-only, single-asset by design (confirms assumption A1). No token pickers, no token names anywhere in UI. Cross-chain = *the platform* moves USDC across networks; users never manage multi-chain wallets or gas.

All paths below are under `monorepo/` unless noted.

**What the fleet found (consensus, grounded):**
- The stack is **100% Solana** — zero EVM deps/signers/RPC anywhere (all package.json greps empty; Privy wired Solana-only at `apps/web/src/services/privy/PrivyBridge.tsx:7,17,84`).
- The send path is **handle-only** at exactly three choke points: DTO (`packages/shared/src/contracts.ts:170-174` — `toHandle` only), route (`apps/backend/src/routes/index.ts:245-247` — 404 `recipient_not_found`), UI (`apps/web/src/store/usePayStore.ts:394-396` — scanned address → dead-end error "That wallet isn't an fpay user yet").
- The on-chain primitive **already supports arbitrary recipients**: `buildUsdcTransfer({toOwner})` validates via `new PublicKey`, auto-creates the recipient ATA (`apps/backend/src/services/solana.ts:85-127`), and `createPendingTransfer` already tolerates `toUserId: null` + raw `to_address` (`apps/backend/src/db/queries.ts:264-288`; proven by faucet/escrow rows).
- **The actual "disconfigured" root causes** (practitioner lens, corrected by adversarial verify panel — two independent skeptics converged on the same primary cause):
  1. **PRIMARY (deterministic): KYC is broken by a placeholder.** `apps/backend/.env:29` has `STAGE_DIDIT_WORKFLOW_ID=<your workflow id>` (literal placeholder) with `STAGE_KYC_PROVIDER=didit` (`.env:27`). The boot guard `assertKycConfig` only rejects *empty* values (`kyc/index.ts:22`), so the server boots "healthy," but every `/kyc/verify` POSTs the garbage workflow id to Didit (`didit.ts:57-65`) → non-2xx → `503 kyc_unavailable` (`routes/index.ts:620-624`). No user can reach tier 2 → merchant-pay/cash-out (gated on `kycTier >= 2`, `usePayStore.ts:403`) is dead every time.
  2. **SECONDARY (intermittent): RPC fallback.** `STAGE_SOLANA_RPC_URL`/`STAGE_HELIUS_API_KEY` commented out (`.env:15-16`) → rate-limited public devnet RPC (`config.ts:49`) → intermittent `503 solana_unavailable` (`routes/index.ts:296`).
  3. **NOT a bug:** `PUBLIC_BASE_URL` unset disables the Helius webhook by design — the poller covers confirmation (`helius.ts:19-20`; poller runs because `STAGE_USDC_MINT` is set, `confirmer.ts:46`).

## 1. Recommendation

Ship this as **three workstreams in one milestone**, in this order:

**A. Fix the disconfiguration (hours).** Fix the Didit workflow-id placeholder (set a real id, or flip `STAGE_KYC_PROVIDER=sim` for dev) and harden `assertKycConfig` to reject placeholder values; restore Helius RPC env for backend + web; split the error taxonomy so "invalid recipient" is a typed 400, not a retryable-looking `503 solana_unavailable`.

**B. v1 feature (days): Solana direct-address send, end-to-end + honest network detection.** One new mini-flow with two entries (paste/type in PeopleSearch, and the existing QR-scan address branch). Address classification is pure client logic: base58-decode to 32 bytes → Solana → proceed; `0x`+40-hex → EVM → show the 5 EVM networks as named, recognizable rows marked "coming soon" (de-crypto naming, no "EVM/chain" jargon). Solana sends execute through the existing prepare→sign→submit rail with a **new mandatory confirm step**, full compliance re-attachment, and a `chain` column on `transfers`.

**C. v2 (deferred, flag-gated): cross-chain USDC delivery, one destination network at a time.** Reframed by Bridge's USDC-only constraint: user balances stay on Solana; "send to a Base/Arbitrum/… address" means the **platform** moves USDC cross-chain — the natural design is Circle **CCTP** (burn USDC on Solana → mint on destination), where the user signs only the familiar fee-payer-sponsored Solana leg (identical UX to today) and the backend (or a CCTP relayer) executes the destination-chain mint/delivery and pays its gas. Users never get EVM wallets, never see gas, never see tokens — they send dollars to an address on a named network. Order: Base or Arbitrum first; Ethereum mainnet later (destination gas cost per delivery is high for small transfers); **Monad last** (verify CCTP/USDC support at v2 planning time — treat CCTP's exact chain coverage as an open verification item, not a settled fact). Still required: viem + per-chain RPC + destination USDC/CCTP contract registry, a backend EVM gas wallet per chain, an EVM confirmer branch (`confirmer.ts` chain filter), and chain-aware compliance (normalized screening, travel-rule capture). Fallback if CCTP disqualifies a network: Privy EVM embedded wallets + its ERC-4337 smart-wallets entrypoint (verified present in the installed SDK). This is a subsystem; do not start it inside this milestone.

## 2. Why (load-bearing)

1. **The gap is an unlock through existing rails, not new rails.** No hidden blockers exist downstream (notify/feed/schema all degrade cleanly with `to_user_id=null` — verified by two skeptics), but the change must thread the whole handle-only chain: DTO + `WalletProvider.transfer` type (`contracts.ts:42,170-174`), `real.ts:33-50`, `doSend` (`usePayStore.ts:519`) + scan branch (`:394-396`), the prepare route (`routes/index.ts:245-258`), and both mappers (`apps/web|mobile/src/services/mappers.ts:21`, which currently render "To " with a blank counterparty). (Claim C1 — cross-tier-survived 2/3, anchors grounded)
2. **5 of 6 requested networks have no substrate.** Any UI implying Base/Arbitrum/etc. can execute today would either 503 or, worse, mislead users into irreversible wrong-network sends. Detection is honest and cheap; execution is not. (Claim C2 — grounded + cross-tier-survived 3/3)
3. **The "disconfigured" feeling has two concrete root causes — fix them first** or the feature ships into a broken-feeling system: the deterministic Didit workflow-id placeholder killing all KYC/tier-2 flows, and the intermittent public-RPC fallback. (Corrected claim C3′ — the original C3 was struck 2/3 and replaced; the Didit placeholder was independently found by all three skeptics, making C3′ the strongest-grounded finding in this plan)
4. **External sends widen exactly the surfaces that are weakest today**: recipient validation (regex-only client, no on-curve check server), compliance controls living inline in one handler (bypass-by-fork risk), no idempotency key on prepare (double-tap/manual-retry double-send; the auto-retry at `real.ts:44-45` itself is safe — preflight rejects expired blockhashes pre-broadcast), a stage-bypassable rate limiter (`x-dev-user-id` rotation mints fresh buckets while `NODE_ENV=stage` → `isDevelopment=true`, `rateLimit.ts:37`), and a fee-payer ATA-rent drain vector (~0.002 SOL per fresh recipient, worst case ~60 SOL/day at tier-1 caps with dust sends). (Claim C4 — grounded + cross-tier-survived 3/3, mechanism corrected)

## 3. Steelman of the rejected option (full 6-network execution now)

Strongest case: users who received an address from an exchange/friend on Base or Polygon are the *majority* of real-world "send to address" requests; a Solana-only v1 may serve a minority slice, and Privy v3 (already the auth vendor, `apps/web/package.json:14`) supports EVM embedded wallets — so the vendor lift is smaller than "new integration."

Why we still pass: the gasless value prop requires an EVM gas design that doesn't exist in the app and can't be rushed for money movement; per-chain USDC registries, confirmers, and gas funding are each real infra; and compliance obligations (chain-aware screening, travel-rule capture) multiply per chain. Shipping detection-plus-coming-soon preserves the UX promise, collects demand signal (which networks users actually paste), and avoids manufacturing irreversible fund-loss paths under schedule pressure.

Verify-panel note that softens v2 (not v1): the installed `@privy-io/react-auth@3.32.1` is EVM-first (EVM hooks in the main export; Solana is the opt-in subpath the app deliberately uses) and ships a `smart-wallets` entrypoint (ERC-4337). So v2's gas answer is likely "enable Privy embedded EVM wallets + smart-wallet paymaster," a vendor-config lift rather than building a relayer — still a subsystem (registry, confirmer, compliance), but smaller than the draft assumed.

## 4. Assumptions & falsifiers

- **A1 (now CONFIRMED by Bridge, 2026-07-02):** USDC-only, permanently single-asset for now — no asset column or token registry needed; `amount_usdc numeric(20,6)` is safe (USDC is 6dp on Solana and every target EVM chain). UI never mentions tokens.
- **A2 (now VERIFIED, no longer an assumption):** installed `@solana/spl-token@0.4.14` defaults `allowOwnerOffCurve=false` and throws `TokenOwnerOffCurveError` for off-curve recipients. We still add an explicit server-side on-curve check for a clean typed error instead of a 503.
- **A3:** Sending to non-fpay Solana addresses is *desired product behavior* (today it's deliberately blocked at `usePayStore.ts:394-396`). Falsifier: if that block was a compliance decision, v1 scope changes to tier-gated rollout.
- **A4:** Devnet remains the environment; real Helius devnet key is available. Falsifier: if moving to mainnet-beta now, USDC mint + fee-payer funding + compliance review all change.

## 5. Open questions — ANSWERED by Bridge (2026-07-02)

1. **Scope:** Solana-execute + EVM detect/coming-soon. ✔
2. **KYC gating:** yes — tier 2 required for external-address sends. ✔ (`kyc_tier >= 2` check in prepare; plumbing at `queries.ts:1116-1118`, `kyc/index.ts:9`.)
3. **Platform:** web first. ✔
4. **Added constraint:** cross-chain is the end-state direction, USDC-only, tokens never mentioned in UI (see Product decisions above; reshaped v2 into the CCTP framing).

## 6. Implementation plan (v1, grounded)

### Workstream A — de-disconfigure (do first)
| Change | Where |
|---|---|
| **Fix Didit placeholder (PRIMARY):** set a real `STAGE_DIDIT_WORKFLOW_ID`, or flip `STAGE_KYC_PROVIDER=sim` for dev (per KYC runbook) | `apps/backend/.env:27-29` |
| **Harden `assertKycConfig`:** reject placeholder-looking values (e.g. containing `<`/`>`), fail fast at boot instead of 503-ing at runtime | `apps/backend/src/services/kyc/index.ts:18-27` |
| Uncomment/set `STAGE_SOLANA_RPC_URL` + `STAGE_HELIUS_API_KEY` (Helius devnet) | `apps/backend/.env:15-16` (fallback at `apps/backend/src/config.ts:49`) |
| Point web at the same Helius RPC | `apps/web/.env.local:7` (`NEXT_PUBLIC_STAGE_SOLANA_RPC_URL`) |
| Typed 400 `invalid_recipient` from prepare instead of collapsing build errors into `503 solana_unavailable` | `apps/backend/src/routes/index.ts:265-268,296` |
| Fix rate-limit identity: don't honor `x-dev-user-id` under `NODE_ENV=stage` (only true local dev), so buckets can't be rotated by an authenticated attacker | `apps/backend/src/services/rateLimit.ts:37` |
| Rotate plaintext secrets flagged in `apps/backend/.env` (DB password, fee-payer key) — at minimum note for later secret-manager move | ops note |
| (`PUBLIC_BASE_URL` unset is fine — webhook-off is designed poller mode, `helius.ts:19-20`; set it only when deployed) | no action |

### Workstream B — direct-address send (Solana execute, EVM detect)

**Shared (`packages/shared/`)**
1. New `chains.ts` (real module — note `tokens.ts` is *design* tokens): `SUPPORTED_NETWORKS` = solana | ethereum | arbitrum | base | polygon | monad, with `{id, displayName, status: 'live'|'coming_soon'}`; solana live, rest coming_soon. Pure `classifyAddress(input): {kind:'solana'|'evm'|'invalid'}` — base58-decode to exactly 32 bytes → solana; `/^0x[0-9a-fA-F]{40}$/` → evm. (Type-only imports from backend per workspace rule.)
2. `contracts.ts`: `PrepareTransferRequest` gains optional `toAddress` (mutually exclusive with `toHandle`); `WalletProvider.transfer` (`contracts.ts:42`) widens to accept `{toHandle} | {toAddress}`; `ApiTxn` gains `toAddress?` + `chain?`.

**Backend (`apps/backend/`)**
3. Schema: `alter table transfers add column if not exists chain text not null default 'solana'` in the existing idempotent migration block (`db/schema.sql:214-239` precedent).
4. `/transfer/prepare` (`routes/index.ts:238-298`): branch on `toAddress` —
   - Server-side validation: base58 decode + 32-byte length + **ed25519 on-curve** (`PublicKey.isOnCurve`) → typed 400 `invalid_recipient` otherwise. Reuse `isValidPubkey` (`services/solana.ts` — extend with on-curve).
   - **Reject self-send** (address == sender wallet) and **known protocol addresses** (fee payer, merchant treasuries) with typed errors.
   - Re-attach ALL existing controls in the same `withUserLock`: `checkSendLimit` with `kind='send'` (so it rolls into `recentSendVolumeUsd`, `queries.ts:1176-1185`), `screenAddress` (normalize per network: lowercase EVM hex before denylist match — fix exact-match bypass at `queries.ts:1199-1202`), `scoreAndRecord`.
   - Insert with `toUserId: null, toAddress, chain:'solana'` (`createPendingTransfer` needs no change).
   - **Min send amount for external recipients (e.g. $1)** plus a **per-user daily cap on distinct new external recipients** (e.g. 10/day) to blunt the fee-payer ATA-rent drain (each fresh recipient ATA costs the fee payer ~0.00204 SOL — `solana.ts:102-110`; worst case without these ≈ 60 SOL/day per account at tier-1 caps).
   - **Idempotency key** on prepare (client-generated UUID, unique column). Corrected rationale from verify panel: the existing `/blockhash/i` auto-retry (`real.ts:44-45`) is safe (preflight rejection = never broadcast), but nothing dedupes a UI double-tap or a manual resend after the Privy SDK's ambiguous "confirmation timed out" error — the key closes both.
5. `risk_events`: add recipient address to the audit row (`insertRiskEvent`, `queries.ts:1204-1216`; schema `:174-183`).
6. Feed: `listTransactionsForUser` selects `t.to_address, t.chain` (`queries.ts:133-135`); confirmer untouched (v1 rows are all chain='solana'; the chain column future-proofs `getPendingSignatures` filtering for v2).

**Web (`apps/web/`)**
7. `lib/qr.ts`: extend classifier to return `{kind:'address', network:'solana'|'evm'}` using shared `classifyAddress`; keep Solana Pay URI handling; strip `ethereum:` URIs. **USDC-only guard:** if a scanned Solana Pay URI carries an `spl-token` param that isn't our USDC mint, reject with a friendly "can't pay this request" — never silently substitute USDC for a requested other token.
7b. **Copy rule everywhere in this feature (Bridge constraint):** amounts are dollars only — "$25.00", never "25 USDC"; no token names, tickers, or token pickers anywhere. Network names (Solana, Base, …) are the only permitted crypto surface.
8. `usePayStore.ts:394-396`: replace the dead-end with routing into the external-send flow. New sheet ids: `sendAddress` (confirm/nework step) — reuse existing sheet plumbing (`SheetHost.tsx`).
9. `friends.tsx` PeopleSearch: when the query classifies as an address (alongside `queryHandle` at `:238`), replace the "isn't on fpay yet" empty state (`:327`) with a "Send to this wallet address" row (truncated address). Live states: valid Solana → proceed; valid EVM → network sheet with 5 named "coming soon" rows ("Which network did they give you?" — collects the tap as demand signal, then explains Solana-only for now); invalid → gentle inline error.
10. **New confirm step (mandatory for external sends only):** truncated monospace address, network badge, amount + rate pill (reuse `RateLock`), irreversibility line ("Double-check the address — money sent to the wrong place can't be recovered"), then `doSend` variant calling `wallet.transfer({toAddress, amountUsd})` (`real.ts:33-50` gains the address field). Friend sends stay warning-free.
11. `TxCard`/mappers: external send renders as `type:'send'` with truncated address as title; fix blank-counterparty fallback (`apps/web/src/services/mappers.ts:21`).

**KYC gating (pending Q2):** if yes — require `kyc_tier >= 2` for `toAddress` sends in prepare (tier from `getUserKycTier`, `queries.ts:1116-1118`; approved tier = 2, `kyc/index.ts:9`).

**Explicitly deferred to v2:** all EVM execution (Privy EVM wallets, viem, per-chain RPC/USDC registry, paymaster/relayer gas design, EVM confirmer branch in `confirmer.ts:19-31` + `getPendingSignatures` chain filter, chain-aware travel-rule/TDS hooks). Mobile parity (mobile is on the old mock flow — separate effort). Enforcing `review` risk decisions (pre-existing gap — flag but don't silently change P2P behavior in this milestone; revisit with Bridge).

## 7. Verification (how we'll know it works)

1. `yarn workspace @fpay/backend dev` (Bridge runs servers — no auto-start) + `yarn web`; devnet with funded fee payer.
2. Workstream A first: `/kyc/verify` no longer 503s (sim provider instant-promotes, or real Didit workflow id works per KYC runbook); boot fails fast if a placeholder workflow id is present; sends stop intermittently 503-ing once Helius RPC is set.
3. Happy path: paste a fresh devnet Solana address (no ATA) → confirm sheet → send → recipient ATA created, USDC arrives (check via explorer), row shows truncated address (not blank "To "), status flips confirmed via poller.
4. Rejection matrix: EVM `0x…` address → network sheet → coming-soon (no send possible); token-account/PDA address → typed 400 `invalid_recipient` (not 503); own address → blocked; denylisted address (seed one, in both checksummed and lowercase forms for EVM-shaped entries) → blocked; sub-$1 → blocked; >10 new external recipients/day → blocked; tier limits enforced (attempt > cap); tier-1 user attempting external send → KYC prompt (if Q2 = yes).
5. Idempotency: fire prepare twice with the same key → one pending row; double-tap the confirm button → one send.
6. Regression: contact/@handle send unchanged; merchant-pay flow works end-to-end again (it's currently dead from the Didit placeholder); feed renders both counterparty kinds.

## Deliberation record

- **Consensus:** Solana-only stack (8/8); handle-only choke points (route/DTO/UI); primitive + ledger already external-ready; v1 = Solana execute + honest detect.
- **Grounding check (4a): 23/26 VERIFIED, 3 corrected, 0 struck.** Corrections: `isValidPubkey` pinned to `solana.ts:55-63`; `transfers.signature unique` pinned to `schema.sql:36`; Privy EVM support confirmed but lives in the SDK's *default main export* (Solana is the opt-in `/solana` subpath) — strengthens the v2 feasibility note. Library checks confirmed against installed sources: `@solana/spl-token@0.4.14` defaults `allowOwnerOffCurve=false` and throws `TokenOwnerOffCurveError` (assumption A2 now grounded); `PublicKey.isOnCurve` exists in `@solana/web3.js@1.98.4`.
- **Contradictions resolved:** `isValidPubkey` line drift (pinned by grounding pass); Monad drop-vs-defer → detect-only in v1 either way, last in v2 order.
- **Unique catches folded in:** disconfiguration root cause (practitioner); zombie-pending hazard + chain column (data-integrity); `kind='send'` cap aggregation + denylist case bypass + risk_events counterparty gap (regulatory); 503-collapse × auto-retry double-send (adversary); confirm-step + two-entries-one-flow (UX); fee-payer ATA-rent drain (orchestrator — needs verification).
- **Adversarial panel (4b), 2× Opus + 1× Sonnet, refute-by-default:**
  - C1 (thin unlock): 1 refute / 2 not-refute → **survives**, rephrased ("no hidden blockers" but full client chain must be threaded; mappers included).
  - C2 (zero EVM): 0/3 → **survives**; bonus finding: Privy SDK is EVM-first with smart-wallets (ERC-4337) entrypoint → v2 gas lift smaller than drafted.
  - C3 (disconfig root cause): **2/3 REFUTED → STRUCK** and replaced by C3′: primary = Didit workflow-id placeholder (deterministic KYC/tier-2/merchant-pay outage, found independently by all 3 skeptics), secondary = RPC fallback (intermittent), webhook-off = designed.
  - C4 (compliance fork): 0/3 → **survives**; mechanism corrected (auto-retry is safe; the gap is absence of any idempotency key) and extended (stage rate-limit bypass via `x-dev-user-id`, drain quantified ~60 SOL/day worst case).

> Cross-tier verification reduces instance-/tier-level error correlation but not shared-lineage
> blind spots. Treat cross-tier survival as weaker evidence than grounding.

- **Loop status:** verify-fold treated as round 1; it produced material changes (C3 replaced, C1 rephrased, C4 mechanism fixed) which are all folded above. No second fan-out round run — remaining deltas are product decisions only Bridge can make (scope/KYC-gate/platform), listed in §5. Unresolved: those three questions.

## Changelog (what the loop changed)
- Round 1 (grounding + skeptics): C3 struck → replaced with the Didit-placeholder primary cause; Workstream A reordered around it; C1's "3 blockers" softened to the full client-chain list (added `contracts.ts:42`, both `mappers.ts:21`); C4's double-send mechanism corrected to "no idempotency key" (auto-retry itself is safe); added stage rate-limit identity fix + per-day new-recipient cap; Privy smart-wallets finding shrank v2's estimated gas lift.
- Round 2 (Bridge's answers + new constraint): all three product questions locked (Solana-execute v1, tier-2 gate, web-first); USDC-only/no-token-mention constraint added (confirms A1, adds copy rule + Solana Pay `spl-token` guard); v2 reframed from "user EVM wallets + paymaster" to **platform-side cross-chain USDC delivery (CCTP burn-on-Solana → mint-on-destination)** with Privy smart-wallets demoted to fallback. Open risk not closed: CCTP chain coverage (esp. Monad) unverified — flagged as a v2-planning verification item.

## Telemetry
- divergence: 0.57 (evidence 0.78, conclusion 0.25) | threshold 0.30 UNCALIBRATED
- models: draft=fable · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: C1 cross-tier-survived (anchors grounded) · C2 grounded · C3′ grounded (replaced struck C3) · C4 grounded (mechanism corrected)
- fleet: 8 lenses + 1 grounding verifier + 3 skeptics
- grounding: 23/26 verified, 3 corrected, 0 struck
- persistence note: plan-mode restricts writes to this plan file; on approval, copy to `monorepo/docs/` per naming convention and seed `.prism/project-model.md` (currently missing) with the invariants + decision log entry
