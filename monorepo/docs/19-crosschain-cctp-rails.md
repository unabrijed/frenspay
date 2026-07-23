# v2 cross-chain USDC: CCTP V2 platform rail (Solana ↔ Base/Ethereum/Arbitrum), testnets first

**Status:** APPROVED, implementation IN PROGRESS — continuation state below.

## Continuation state (2026-07-23)

**Done (compiles except one known one-liner):**
- W0 ✅ — `viem@2.55.5` in backend; config.ts keys (per-chain RPCs, `evmMinterPrivateKey`, `irisApiUrl` tier default, `cctpFeeUsd`/`cctpInFeeUsd` maps, `bridgeRailOut/In`); `services/bridge/cctp/constants.ts` (verified addresses, mainnet/testnet sets by tier); `CCTP_DOMAINS` in shared chains.ts.
- W1 ✅ — `bridge_transfers` + `bridge_events` schema appended (NOT yet applied to stage DB — `db:init` pending); queries: `insertBridgeTransfer`, `getBridgeByTransferId`, `casBridgeState` (CAS + patch + jsonb merge), `listBridgeDue`, `appendBridgeEvent`, `attachPlatformTransferSignature`; feed join in `listTransactionsForUser` (bridge rows show EVM-side chain, pending-until-settled).
- W2 ✅ — faucet swapped to `sendUsdcFromTreasury` (official-USDC treasury; `faucet_empty` 503; caps 10/50); `setup-devnet.ts` rewritten (official mint enforced, treasury funding, Circle-faucet instructions); CCTP V2 IDLs vendored (`services/bridge/cctp/idl/*.json`, fetched from circlefin/solana-cctp-contracts examples/target); `services/bridge/cctp/solana.ts` — `buildDepositForBurnTx` (user-signed burn + atomic fee ix + event-keypair co-sign, returns eventAccount for rail_data) AND `receiveMessageOnSolana` (inbound settle, full remainingAccounts list per Circle's reference).
- **Known fix on resume (only typecheck error):** `bridge/cctp/solana.ts:152` — `tmm.account.tokenMessenger` doesn't exist on untyped `Program<Idl>`; cast: `(tmm.account as Record<string, { fetch(pk: PublicKey): Promise<unknown> }>).tokenMessenger.fetch(…)`.

**Remaining (in order):** fix the cast → W3 (iris.ts, evmMinter.ts, rail.ts + registry.ts, machine.ts, poller.ts, rails/cctpStandard+cctpFast, orderMachine hook line, server.ts start, metrics, notify) → W4 (routes/crosschain.ts + shared contracts + rate-limit rule) → W5 (web: chains live flip, api wrappers, store network branch, SendNetwork picker, confirm fee/ETA rows) → W6 (check-cctp.ts preflight, docs/19 runbook, .env STAGE_ keys) → `db:init` → typecheck all + behavioral checks → inbound Wi7–Wi10 (PrivyRoot smart wallets + SmartWalletsProvider, evmAddress capture on sync, deposit endpoints with Iris-reconciled amounts, AddMoney "From another wallet", localStorage resume) → full verification → docs/memory updates → commit.

## Context

Bridge's scope (2026-07-22): web-app only; cross-chain "swaps" = moving USDC across chains (USDC is the only asset — these are transfers, not token swaps); priority chains **Base, Ethereum mainnet, Solana, Arbitrum** (rest de-prioritized); must be cheap; full **testnet support for all four chains** for testing/staging. This is the v2 unlock for the "coming soon" networks shipped in docs/16-18.

## Research (verified 2026-07-22)

**Rail comparison for small USDC transfers on our corridor (Solana ↔ Base/Eth/Arb):**

| Rail | Solana? | Fee (protocol) | Small-transfer fit | Testnets |
|---|---|---|---|---|
| **CCTP V2 Standard** | ✅ (Oct 2025, V2 canonical / V1 deprecated) | **$0** — gas only | ✅ best (no flat fee, no slippage, native mint — no wrapped assets) | ✅ Sepolia/Base Sepolia/Arb Sepolia + Solana devnet + Iris sandbox attestation API |
| CCTP V2 Fast | ✅ | 0–14 bps | optional speed lane (8–20s vs source-chain finality) | ✅ same |
| Across | ❌ EVM-only | 0.02–0.08% | fastest EVM intent bridge, but no Solana hub | ~none (intent solvers) |
| deBridge | ✅ | 0.04% + **flat component** | flat fee punishes <$500 transfers — ours are small | ~none |
| LI.FI/Squid aggregators | ✅ | +5–25 bps on top of underlying | strictly worse than going direct for one fixed corridor | ~none |

**Decision-shaping facts:** Ethereum-mainnet destination gas ($1–10) is expensive on EVERY rail (L1 physics) — Base/Arb destinations are cents; CCTP uses Circle domain IDs (not chain IDs) with attestations fetched from the Iris API (sandbox for testnets); CCTP V2 already matches the chain-list principle codified in `chains.ts` (listed ⇔ native USDC + CCTP-reachable).

Sources: [CCTP fees](https://developers.circle.com/cctp/concepts/fees) · [finality & fees](https://developers.circle.com/cctp/cctp-finality-and-fees) · [V2 launch](https://www.circle.com/blog/cctp-v2-the-future-of-cross-chain) · [V1 deprecation](https://www.circle.com/blog/cctp-version-updates) · [technical guide](https://developers.circle.com/cctp/technical-guide) · [bridge fee comparison](https://eco.com/support/en/articles/15197981-cross-chain-bridge-fees-2026-every-major-bridge-compared) · [Circle testnet sample app](https://github.com/circlefin/circle-cctp-crosschain-transfer)

**Recommendation: CCTP V2, platform-side, Standard Transfer default.** Zero protocol fee + no wrapped assets + the only credible testnet story. User's own wallet burns via a server-built, fee-payer-sponsored `depositForBurn` on Solana (self-custody preserved, same prepare→sign→submit shape as every send today); backend poller fetches the Iris attestation; a platform EVM wallet submits the mint on the destination chain and pays that gas. Fast Transfer is a later opt-in lane, not v1 of this feature.

**Known wrinkle (must be resolved in design):** devnet "USDC" today is a custom mint we control (faucet = mintTo). CCTP only burns **Circle's official** devnet USDC. Staging likely needs: switch devnet to official Circle USDC + refactor the faucet to transfer from a pre-funded treasury (Circle testnet faucet seeds it) instead of minting.

## Exploration (verified) — reuse-vs-build map

| Area | Reuse | Build new |
|---|---|---|
| State machine | CAS-claim (`casOrderState` pattern), broadcast-first-advance-second, append-only event log, SLA worker tick | `cctp_transfers` machine (`burn_pending → burned → attesting → attested → minting → minted / failed`) — orderMachine is merchant-coupled (FKs to quotes/merchants) |
| Platform signing | `feePayer()` loader + sign/`sendRawTransaction` shape (`escrowProgram.ts:115-156` precedent) | Solana `depositForBurn` ix builder; EVM mint signer |
| Pollers | 15-line skeleton (interval + re-entrancy guard + unref; `kyc/poller.ts` duality precedent), register in `server.ts:44-57` | Attestation (Iris) + EVM-mint pollers — Solana confirmer is `chain='solana'`-locked by design (`queries.ts:505-513`) |
| transfers table | Per-leg rows + confirm-by-signature; `kind` CHECK widening precedent exists | Companion `cctp_transfers` (nonce/attestation/source_sig/dest_sig) — `signature UNIQUE` means one row can't hold two legs |
| Quotes | 45s lock + persist + check-on-consume pattern (`quoteEngine.ts:24-57`) | New quote economics (destination gas + ETA; no INR/merchant) |
| Config | `env()` LOCAL_/STAGE_/bare tiering verbatim | ~4 keys (per-chain RPC, EVM minter key hex parser, attestation URL); Circle domain IDs → `shared/chains.ts` constants |
| EVM | nothing exists (no viem/ethers anywhere; 0x = classify-and-refuse only) | entire mint leg — add `viem` to backend |

## Bridge's decisions (2026-07-22)

1. **Both directions** — outbound (Solana → Base/Eth/Arb) AND inbound (EVM → fpay balance). Inbound design addendum in progress; outbound ships first regardless.
2. **Fee policy: free L2s, pass-through L1** — absorb cents on Base/Arbitrum ("Network fee — Free"), visible flat dollar fee on Ethereum (default $2, config-driven per chain: `CCTP_FEE_USD_*`).
3. **Devnet USDC: full switch to Circle's official devnet USDC** — faucet becomes treasury-transfer (seeded from faucet.circle.com), custom-mint stage balances accepted as a reset, prod unchanged. Verified safe: the mint is config-only everywhere except the faucet + setup script.

## Verified protocol facts (Circle docs, fetched 2026-07-22)

- Domains: Ethereum=0, Arbitrum=3, Solana=5, Base=6. Iris: sandbox `iris-api-sandbox.circle.com` / prod `iris-api.circle.com`, `GET /v2/messages/{srcDomain}?transactionHash=`, 40rps.
- EVM contracts (same address across Eth/Base/Arb): TokenMessengerV2 `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` (mainnets) / `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` (Sepolias); MessageTransmitterV2 `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` / `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`.
- Solana programs (both clusters): MessageTransmitterV2 `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC`, TokenMessengerMinterV2 `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe`. Official devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- Solana-source Standard: 32 confirmations, attestation ~25s → "arrives in ~1 min" is honest copy. Solana `depositForBurn` quirks: mintRecipient = 32-byte left-padded EVM address; fresh MessageSent event-account keypair must co-sign (rent ~0.0035 SOL, reclaimable after 5 days).

## Design corrections adopted (agent pushback, all verified)

1. **No `kind` widening — cross-chain sends stay `kind='send'`**: daily-cap (`recentSendVolumeUsd`) and recipient-cap queries filter on it; the `cctp_transfers` join is the differentiator.
2. **ONE `transfers` row per send** (the Solana burn leg, `chain='solana'` → existing confirmer follows it with zero changes); two rows would double-count caps and duplicate feed entries. Feed reads `left join cctp_transfers`: status stays `pending` until `minted`.
3. **No quote table** — fee is a config constant per destination; stateless `GET /crosschain/quote`; prepare recomputes authoritatively.
4. **Claim-first (CAS) before mint broadcast** (refund shape, not release shape): duplicate `receiveMessage` costs gas; loser reverts on used-nonce.

## Rail abstraction (Bridge, 2026-07-22: "mix of protocols — abstraction architecture")

Protocols are pluggable **rails** behind one interface; which rail serves which corridor is **config, not code**. v1 ships two rails — `cctp_standard` (outbound default: free) and `cctp_fast` (inbound default: seconds, bps fee) — which already exercise the whole interface since they differ in args, fees, and polling cadence. A future deBridge/Across/other rail is a new file implementing the same interface + a config line.

```ts
// services/bridge/rail.ts (backend)
interface Rail {
  id: string;                                                   // 'cctp_standard' | 'cctp_fast' | …
  serves(source: NetworkId, dest: NetworkId): boolean;
  quote(source, dest, amountUsd): Promise<{ feeUsd; railFeeUsd; etaSecs }>;   // railFee = protocol's own cut
  buildSourceLeg(args): Promise<SourceLeg>;   // Solana source → user-signable tx; EVM source → sponsored-userOp calls
  advance(row: BridgeTransferRow, ctx: MachineCtx): Promise<void>;  // one due-row step; uses shared CAS/event/backoff helpers
}
// services/bridge/registry.ts: RAILS list + railFor(source, dest) — route prefs from config:
//   BRIDGE_RAIL_OUT=cctp_standard  BRIDGE_RAIL_IN=cctp_fast   (per-corridor overrides later, e.g. BRIDGE_RAIL_SOLANA_ETHEREUM=…)
```

- **Generic state machine, rail-owned internals**: `created → source_submitted → source_confirmed → ready → settling → settled / failed` (CCTP maps attested→ready, minting→settling, minted→settled; an intent rail would map solver-filled→ready). Rail-specific artifacts (message hex, attestation, nonce / future: order ids) live in a `rail_data jsonb` column — no schema change per new rail.
- **Shared machinery stays rail-agnostic**: CAS transitions, append-only events, `next_attempt_at` backoff, the poller loop (`advance` dispatch by `row.rail`), compliance block, feed join, notifications.
- Table/file naming goes generic: **`bridge_transfers`/`bridge_events`**, **`services/bridge/`** with `rails/cctpStandard.ts`, `rails/cctpFast.ts` (both thin over shared `cctp/` primitives: burn builder, Iris client, EVM minter, Solana receiver).
- `ponytail:` exactly two rails ship; the interface exists because two consumers exist TODAY (standard/fast) and Bridge explicitly wants protocol mixing — no speculative third adapter.

# Implementation plan — OUTBOUND (Solana → Base/Ethereum/Arbitrum)

## W0 — deps + config + constants
`viem` added to backend only. `config.ts`: `ethereumRpcUrl/baseRpcUrl/arbitrumRpcUrl`, `evmMinterPrivateKey` (0x-hex, lazy `privateKeyToAccount`), `irisApiUrl` (tier default: sandbox for dev/stage, prod for production), `cctpFeeUsd` per chain via `num()`. NEW `services/cctp/constants.ts`: domain IDs + per-destination `{usdc, tokenMessenger, messageTransmitter, feeUsd, etaSecs}` keyed by NetworkId, mainnet/testnet sets by `config.isProduction`. Circle domains also exported from `shared/chains.ts` (`CCTP_DOMAINS`).

## W1 — schema + queries
New `bridge_transfers` (companion, `transfer_id unique` FK): **`rail text not null`** (cctp_standard/cctp_fast), `direction` ('out'/'in'), source/destination chain + domain, recipient (lowercase 0x or Solana ATA), amount/fee/rail_fee, generic `state` CHECK `created → source_submitted → source_confirmed → ready → settling → settled / failed`, `source_tx` + `settle_tx`, **`rail_data jsonb`** (CCTP: message hex, attestation, nonce — no schema change per future rail), retry_count, next_attempt_at, resolution (delayed/needs_action), timestamps; partial index on active `(state, next_attempt_at)`; partial unique on `source_tx` (dedupes re-reported inbound burns). New `bridge_events` (append-only, `order_events` mirror). Queries: `insertBridgeTransfer`, `casBridgeState` (CAS copy of `casOrderState`, + patch + rail_data merge), `listBridgeDue`, `appendBridgeEvent`; `listTransactionsForUser` gains the join (chain → the EVM-side chain, status settled→confirmed / failed→failed / else pending).

## W2 — devnet USDC swap + burn builder (build FIRST — highest uncertainty)
- `solana.ts`: `mintUsdcTo` → `sendUsdcFromTreasury` (fee-payer `transferChecked` from its own ATA; `faucet_empty` 503); `money.ts:318` call-site; `setup-devnet.ts` drops createMint/mintTo, requires the official mint, prints Circle-faucet funding instructions; faucet default 10 / cap 50 (Circle faucet drip rate).
- NEW `services/cctp/burnBuilder.ts` + vendored V2 IDLs: `buildDepositForBurnTx({fromOwner, destinationDomain, mintRecipient0x, amountUsd, feeUsd})` — optional atomic USDC fee-transfer ix to the fee-payer ATA when fee>0; anchor `depositForBurn(amount, domain, mintRecipient, destinationCaller=default, maxFee=0, minFinalityThreshold=2000)`; fresh event keypair co-signs + fee-payer partial-sign; returns `{unsignedTx, feePayer}` (same contract as `buildUsdcTransfer` — client signer unchanged).

## W3 — rail interface + CCTP primitives + machine + poller
- `services/bridge/rail.ts` + `registry.ts`: the interface + `railFor(source, dest)` from config (`BRIDGE_RAIL_OUT`/`BRIDGE_RAIL_IN` defaults; per-corridor overrides read if present).
- Shared CCTP primitives under `services/bridge/cctp/`: `iris.ts` (plain fetch, null on 404/pending; also the fees endpoint for fast quotes), `evmMinter.ts` (only viem file: lazy per-chain clients, `receiveMessage(bytes,bytes)` one-function ABI, receipt status, balances), `burnBuilder.ts` (W2), `solanaReceiver.ts` (inbound Wi9).
- `rails/cctpStandard.ts` + `rails/cctpFast.ts`: thin — differ in `minFinalityThreshold` (2000 vs 1000), `maxFee` (0 vs Iris-quoted), fee math, ETA constants, and backoff cadence. Both drive the same generic states.
- `services/bridge/machine.ts`: shared CAS + event + backoff helpers, `onBridgeSourceConfirmed(transferId)` hook, `advanceBridgeOnce` (dispatch: `railFor(row).advance(row, ctx)`).
- `services/bridge/poller.ts` (kyc/poller skeleton, 5s, no-op without minter key): self-heal from companion-transfer status; source_confirmed→attestation→ready (standard backoff 5→30s / fast 5→15s; 'delayed' resolution past threshold; NEVER expires post-burn); ready→CAS settling→settle broadcast (throw ⇒ revert+backoff; out-of-gas ⇒ needs_action + `bridge_settler_broke`); settling→receipt/confirm→settled+notify / reverted ⇒ back to ready.
- Hook: one line in `onTransferConfirmedAndNotify` (webhook + poller both funnel there). `server.ts`: `startBridgePoller(5000)`. Metrics: bridge_settled/settle_retries/attestation_delayed/settler_broke. `notify.ts`: "$50 arrived on Base".

## W4 — routes + contracts
NEW `routes/crosschain.ts` (registered in routes/index.ts): `GET /crosschain/quote` (stateless; resolves the rail via `railFor()` and returns its quote; 503 `crosschain_unavailable` when tier lacks minter/RPC), `POST /crosschain/prepare` — **full compliance block replicated in money.ts order**: EVM validate + lowercase, self/minter reject, tier-2 gate, $1 min, recipient cap (join makes cross-chain rows count automatically), idempotency replay-from-ROW, withUserLock → checkSendLimit(amount+fee) → screenAddress both parties → scoreAndRecord → `rail.buildSourceLeg()` → `createPendingTransfer({kind:'send', chain:'solana'})` + `insertBridgeTransfer({rail: rail.id})`; `POST /crosschain/submit` (owner-scoped attach + CAS created→source_submitted). Rate-limit rule: prepare in the `send` bucket. Shared contracts: quote/prepare/submit types (quote response carries `railFeeUsd` broken out so the UI can show one combined dollar fee).

## W5 — web
`chains.ts`: base/ethereum/arbitrum → `'live'`. `api.ts` 3 wrappers. Store: `externalSend.network`, `selectNetwork(id)` (quote fetch best-effort), `doSendExternal` branches (EVM → prepareCrosschain → same Solana signer → submitCrosschain, blockhash-retry + idempotency preserved), friendly errors (`crosschain_unavailable`). `sendAddress.tsx`: SendNetwork = live picker on top + coming-soon below; confirm sheet adds "Network fee — Free/$2.00" + "Arrives in about 1/2 minutes" (dollars only, no gas talk). Feed: no structural change (join handles status).

## W6 — setup + preflight + runbook
NEW `scripts/check-cctp.ts` (read-only preflight: PDA derivation, dummy burn build, Iris sandbox ping, 3 Sepolia RPC connects, minter/treasury balances). Funding runbook → docs/19: Circle faucet (Solana devnet USDC treasury), Sepolia/Base-Sepolia/Arb-Sepolia ETH faucets (one 0x address, three chains).

## State machine (outbound — shown in CCTP-rail terms; generic names per the abstraction mapping: burn_submitted=source_submitted, attested=ready, minting=settling, minted=settled)

| Edge | Advanced by | Guard / failure |
|---|---|---|
| →created | /crosschain/prepare | compliance block; idempotency unique |
| created→burn_submitted | /crosschain/submit | owner-scoped attach + CAS; abandoned → existing stale-expiry fails companion → poller sweeps to failed |
| burn_submitted→burn_confirmed | confirmer/Helius hook + poller self-heal | CAS idempotent across paths; burn reverted → failed (nothing left wallet) |
| burn_confirmed→attested | poller (Iris) | backoff; >10min = 'delayed'; never expires (funds burned ⇒ attestation guaranteed) |
| attested→minting | poller (viem) | **CAS-claim BEFORE broadcast**; throw ⇒ revert+retry_count+backoff; out-of-gas ⇒ needs_action |
| minting→minted | poller (receipt) | reverted ⇒ back to attested (attestation replayable, gas-bump retry) |

No state exists where user funds are burned and unrecoverable.

## Costs (Standard, protocol $0; receiveMessage ≈150-180k gas)

| Dest | Platform gas | Config default | User sees |
|---|---|---|---|
| Base | <$0.01–0.05 | fee 0 (absorb) | "Network fee — Free · ~1 min" |
| Arbitrum | $0.01–0.10 | fee 0 (absorb) | "Network fee — Free · ~1 min" |
| Ethereum | ~$0.50–5 (spikes $10+) | fee $2 visible | "Network fee — $2.00 · ~2 min" |

Fee collected as atomic USDC transfer inside the burn tx. Burn-leg rent (~0.0035 SOL) fee-payer-sponsored, reclaim deferred (`ponytail:` cron when volume matters).

## Testnet env (STAGE_; LOCAL_ falls back automatically)
`STAGE_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, `STAGE_{ETHEREUM,BASE,ARBITRUM}_RPC_URL` (publicnode/base.org/arbitrum.io Sepolia RPCs), `STAGE_EVM_MINTER_PRIVATE_KEY` (one key, three chains), `STAGE_CCTP_FEE_USD_{ETHEREUM=2,BASE=0,ARBITRUM=0}`, **`STAGE_BRIDGE_RAIL_OUT=cctp_standard`, `STAGE_BRIDGE_RAIL_IN=cctp_fast`** (the protocol-mix knobs). Contract addresses = code constants by tier, not env.

## Risks
Solana CCTP account-list drift (guard: check-cctp.ts + one devnet dry run; build W2 first) · event-account rent accrual (reclaim deferred) · minter nonce contention (sequential poller pass; per-chain queues later) · Ethereum gas spike vs flat $2 (absorbed; metric + runbook) · Iris outage (post-burn never expires; "delayed" copy) · stage cutover resets old-mint balances (accepted; settle in-flight escrow orders first).

## Out of scope (this release)
Fast Transfer (seam = builder args + fee config) · other chains · mobile · dynamic gas-oracle fees · CCTP hooks/destinationCaller · rent-reclaim automation.

# INBOUND (EVM → fpay balance) — pull-based, self-custody, sponsored burn

**Chosen shape (C's UX + A(i)'s signing):** deposit address = the user's own **Privy smart wallet** (counterfactual smart account, same 0x address on all 3 chains; funds at rest are the user's — docs/03 custody law preserved); NO background watcher in v1 — the Add-money sheet's "Check for money" reads `balanceOf` server-side and "Move to balance" runs an in-session **paymaster-sponsored 4337 userOp** batching `approve + fee transfer + depositForBurn` signed by the user; the **existing Solana fee-payer** broadcasts `receiveMessage` (no new mint infra — the decisive asymmetry). Platform deposit addresses REJECTED (custody contradicts docs/03); EIP-7702 not one-dev-shippable (adopt if Privy ships 7702 mode — same client code); permit+router contract = documented fallback only.

**Key facts:** inbound Standard ETA is **15–19 min** (EVM-source waits Ethereum L1 finality — the reverse of our fast outbound); Privy smart wallets = dashboard toggle + provider pick, defaults to Pimlico's public bundler, paymaster URL per chain; free sponsorship on all 3 Sepolias (staging works); mainnet ≈ gas + ~10% paymaster markup. Users have no EVM wallet today (`PrivyRoot.tsx:47` mounts bare) — enabling is a config line; `wallets` table already has the `(user_id, chain)` unique index waiting.

## Inbound workstreams (after outbound W0–W6)

- **Wi7 — EVM wallet enablement + capture**: `PrivyRoot.tsx` gains `embeddedWallets.ethereum.createOnLogin` + `SmartWalletsProvider` (same package); `PrivyBridge` registers a `depositBridge.sendSponsoredCalls(chainId, calls)` + passes the smart-wallet address; `AuthSyncRequest.evmAddress?` → validated/lowercased → upsert `wallets(user_id, 'ethereum', address)`; `MeResponse.evmDepositAddress?`. Ops: Privy dashboard smart wallets ON + Pimlico paymaster URLs (Sepolias for stage, mainnets for prod).
- **Wi8 — schema**: mostly absorbed by W1's generic `bridge_transfers` (direction/source columns + source_tx dedupe index are in the base table now). Remaining: companion `transfers` row = always the SOLANA leg: inbound uses **`kind='add'`** ("Added money" rendering for free, and deposits stay out of the send daily-cap by construction), signature attached when the fee-payer broadcasts the mint, confirmed by the existing confirmer. New `attachPlatformTransferSignature` (owner-scoped variant can't sign platform rows).
- **Wi9 — backend**: `GET /crosschain/deposit-info` (address + per-network fee/ETA), `GET /crosschain/deposit-balances` (server-side `balanceOf` via the outbound publicClients), `POST /crosschain/deposit {sourceChain, txHash, amountUsd}` — dedupe, screen, risk-record; **client-asserted amount is provisional: the trust boundary is Iris** (at attestation, reconcile amount AND verify `decodedMessage.mintRecipient` == the caller's own ATA — no crediting someone else's burn, no inflation). New `services/bridge/cctp/solanaReceiver.ts` (anchor receiveMessage, fee-payer signs alone, `ensureAta` reused from escrowProgram). Poller gains 3 inbound edges (state table in addendum §A3): EVM receipt → Iris (30s→5min backoff; 15–19 min is NORMAL; 'delayed' at 30min; "nonce already used" ⇒ verify + minted — permissionless replay is success) → fee-payer mint → confirmer confirms → notify. No post-burn state expires — funds never strandable.
- **Wi10 — web**: Add-money sheet "From another wallet" section (address + QR + network names — this IS on-ramp, allowed surface); "Check for money" → "Move $25 from Base · fee $0 · arrives in ~20 min" (honest ETA); store `doMoveToBalance(network)` builds the batched calls (fee lands on the outbound EVM minter address — inbound fees refuel outbound gas, no new treasury); localStorage-persisted pending deposit re-reported on next open (lost-hash recovery; `ponytail:` watcher later closes it fully).

**Inbound config**: `CCTP_IN_FEE_USD_{ETHEREUM=2,BASE=0,ARBITRUM=0}`; zero new secrets (paymaster pays burn gas, existing fee-payer pays mint, fee treasury = outbound minter address).

**Inbound risks**: lost burn hash pre-report (recoverable — attestation permissionless; localStorage resume) · paymaster vendor dependency (Pimlico public bundler default; prod wants own account, ~10% markup) · confused deposits to the EOA address (only ever display the smart-wallet address) · 20-min ETA expectation (copy honesty) · no KYC gate on money-in from own screened wallet (matches faucet/receive; flagged for compliance sign-off).

**Inbound out of scope**: background watcher/push detection · Fast Transfer (the strongest future fix for the 20-min ETA) · 7702 mode · permit+router fallback · third-party deposits with memo matching · mobile.

## Decision gate — RESOLVED (Bridge, 2026-07-22)

1. **Inbound uses Fast Transfer** (8–20s arrivals; Circle's 0–14bps fee is deducted from the minted amount). Deltas vs the Standard design above:
   - Burn call args: `minFinalityThreshold=1000` (fast) + a real `maxFee` — quoted live from Iris's fees endpoint (`GET /v2/burn/USDC/fees/{srcDomain}/{destDomain}`) at deposit-info time; refuse (fall back to Standard + honest 20-min copy) if the quoted fee exceeds maxFee config ceiling.
   - Fee display = Circle's fast fee (bps) + our per-chain config fee, one combined dollar number: "Move $25 from Base · fee $0.04 · arrives in about a minute".
   - Poller backoff for `direction='in'`: snappy (5s→15s) — fast attestations land in seconds, not the Standard 15–19 min path.
   - Outbound stays Standard/free (Solana-source attests in ~25s anyway — Fast buys nothing there).
2. **Paymaster approved — inbound is BUILD, not parked.** Bridge actions: enable smart wallets in the Privy dashboard (provider: Kernel default) + create a free Pimlico account and paste the 3 Sepolia paymaster URLs. Mainnet paymaster billing = later decision, before prod cutover.

**Build order:** outbound W0–W6 first (zero inbound dependency; W2 first inside that — highest uncertainty), then inbound Wi7–Wi10.

## Verification
No servers: `yarn typecheck`; `tsx scripts/check-cctp.ts`; check-infra still green (cap/kind invariant). Runtime (stage): faucet-from-treasury → per destination: quote → prepare → sign → submit → burn_confirmed (~10s) → attested (~30s) → minted (~60s) → USDC on the Sepolia explorer → feed flips confirmed at minted → notification. Negatives: tier-1 blocked, case-varied denylist 0x blocked, 11th recipient 429, idempotency replay same transferId, poller kill/restart between attest and mint resumes.
