# prism · project model — fpay monorepo

Seeded 2026-08-10 by the Indonesia-corridor prism-plan run. Feed Architecture/Invariants/Danger
zones/Lessons into every fan-out agent; never violate a recorded invariant without flagging it.

> **Doc numbering (2026-08-25):** `docs/` was renumbered to 01–13 by commit `abdf036`. Older
> entries below cite the retired set; read them as: docs/11 (compliance) → `08-compliance-and-legalities`;
> docs/17–18 (pay-target / country) → `01-architecture` + `04-p2p-and-contacts`; docs/21 (rails law)
> → `01-architecture`; docs/22 (Indonesia plan) → `06-offramp-and-settlement`; docs/23 (settlement
> models) → `06-offramp-and-settlement`; docs/24 (moderation) → `07-admin-and-moderation`. The LP
> console is `11-lp-console`. Git history holds the originals.

## Architecture (concern → where it lives)

- **Money/decimals law**: decimal string at rest/wire · BigNumber mid-calculation · bigint at chain edge · `number` only at print — docs/01 §Money & decimals; `packages/shared/src/units.ts` (byte-identical mirror at `apps/backend/src/lib/units.ts`, enforced by `check:money`).
- **Rails/country registry**: `packages/shared/src/rails.ts` — the ONLY country list (docs/21 product law). EMV QR parsing `packages/shared/src/emvqr.ts`; classifier `packages/shared/src/payTarget.ts`.
- **FX**: `apps/backend/src/services/fxRate.ts` (per-currency bands/cache/fallbacks) + `envConfig.fxFallbackRates`; authed `GET /fx/rate?currency=`.
- **Quotes/orders**: `services/quoteEngine.ts` → `routes/orders.ts` (trust boundary: per-rail destination regex, `MIN_ORDER_USD`, KYC caps) → `db/queries.ts` → order worker `services/simMerchant.ts`.
- **Provider abstractions** (interface + config-selected registry + poller-authoritative advance + CAS): crosschain `services/bridge/{rail,registry,machine}.ts`; fiat payout `services/payout/provider.ts` (+ `providers/xendit.ts`, key-gated); KYC `services/kyc/provider.ts`.
- **Webhook contract**: webhook = fast hint, poller = authoritative (`routes/webhooks.ts`: helius, kyc, xendit).
- **Compliance**: `services/compliance.ts` — tiers are USD-denominated and country-blind (correct design; conversions must use the QUOTE's currency rate).

## Invariants (cite before violating)

1. Rails registry is the only country list; going live on a rail IS the multi-currency milestone (docs/21; rails.ts header).
2. Decimals are always a parameter — `fiatDecimals(ccy)`, never a baked constant (docs/01).
3. Rounding law: user owes → UP; fpay delivers → DOWN; protocol fee ceiling → UP (docs/06; units.ts divUp/divDown).
4. `units.ts` exists twice, byte-identical (check:money enforces).
5. Backend may only `import type` from @fpay/shared — runtime values are mirrored + drift-checked (VPA_RE, PAYOUT_METHODS/RAIL_CURRENCY, units.ts).
6. The RAIL is the currency authority — never `users.country` (docs/18: dialing/display preference only, "money paths untouched"), never a QR's own tag-53 claim (cross-check, reject prefill on mismatch, never default a currency).
7. DB fiat columns stay numeric(20,2) scale for every corridor; validation/display decimals live in code.
8. No real payout/on-ramp before real KYC/AML vendor + sanctions + counsel sign-off (docs/11). Payout providers are key-gated test mode only.
   **EXCEPTION, accepted by Bridge 2026-08-29 (docs/14):** while the identity vendor is off
   (`config.personaLive` false — its credentials are blank), a partner is admitted on a human's
   reading of the KYB form rather than a vendor's identity check. **No tier is granted** — that half
   was removed the same day after the audit below; no payer limit moves and there is nothing to sweep.
9. Payee-name confirmation is the anti-wrong-send gate; loose classification is tolerated because of it (docs/17).
10. check-scripts in `check:all` are no-DB, no-network (check-fx's live fetch is opt-in via FX_CHECK_LIVE=1).
11. A DB row is never sufficient to move money: payout-provider registry membership = credential resolves AND row enabled; admin flips can only subtract (disable/reorder); enabling a new money-mover requires a deploy; the sim adapter is excluded from the adapter map in production (docs/23).
12. Refund and failover require a RAW terminal provider status; the worker keeps polling while escalated; REVERSED freezes (orphan event + risk_event), never fails over; REJECTED is terminal-failed (docs/23).
13. `orders.payout_provider_id` is claimed (guarded CAS) BEFORE the first initiate and never silently reassigned; sticky orders keep polling a disabled row — disable affects selection only (docs/23).
14. Provider-model corridors settle through a platform-owned merchants row (`sim_behavior='psp'`, `user_id` NULL) — `merchant_id` stays NOT NULL on every order; platform rows are exempt from bond draws (docs/23).
15. Routing never crosses rails — rail is a hard filter, no fallback (docs/23; the old fallback leaked escrow cross-corridor).
16. Routing's hard filters ALL live in `listRoutableMerchants`' SELECT (online, KYB, rail, country,
    bond ≥ MIN_BOND) — never in a periodic job. The bond floor was previously only in
    `recomputeMerchantStats` (every 10th tick, ~80s), so a zero-stake approved LP was routable in
    the gap. Platform `psp` rows are exempt from the bond floor AND from leverage, same reasoning as
    their dispute-draw exemption (docs/23; queries.ts `listRoutableMerchants`, routing.ts `availableOf`).
17. Effective float = `min(float_usdc, bond_usdc × LEVERAGE[tier])`. `float_usdc` is a self-declared
    claim and was never checked against the stake (merchantStats.ts `LEVERAGE`).
18. `orders.merchant_id` is the PROVISIONAL holder; the lock (`locked_at`) is a CAS that transfers
    it — invariant 14 (never NULL) survives the marketplace. An order is offered only while
    `locked_at is null and now() >= offer_widens_at`; provider/sim orders are **born locked** at
    `payment_detected`, which is what lets `claimOrderPayout` require `locked_at is not null` with
    one predicate and no psp special case (0015; orderMachine `onTransferConfirmed`).
19. The payee is redacted in SQL (`null::text as payout_destination` in `listOpenOffers`), never in
    a mapper. The offer pool is DERIVED per request, never stored — a stored offer list would be a
    stale snapshot of capacity, price and eligibility.
20. An order is only offered to LPs with `spread_bps <= quotes.spread_bps` (the price it was struck
    at). This is what makes broadcasting safe with per-LP pricing: any locker earns ≥ their own ask
    and the payer's quote is never repriced. Requires `quotes.spread_bps` (0015) — `rate` is
    display-only and post-fee, so the spread is unrecoverable from it.
21. The payer must never perceive that a person settles their payment: no LP-aware copy, no
    LP-aware wait state, no LP name on a payer DTO. Any LP-side race happens inside time the payer
    already spends (alert fires at `pay_instructions`, while they sign) — never in front of them.
22. `merchants.suspend_reason` distinguishes machine suspension ('bond') from human (admin
    moderation, user-suspend cascade — both write the same status through `setMerchantStatus`).
    Auto-reinstate may ONLY reverse 'bond', or it silently un-bans a moderated merchant.
23. `users.status` is enforced in `authPreHandler` (403 `account_suspended`, admins exempt — the console must stay reachable for recovery); user-suspend cascades one-way to the owned merchants row (routing/payouts never join users); `resolveHandleToFriend` filters suspended, `findUserByHandle` deliberately does NOT (docs/24).
24. **The tier is the price envelope** (2026-08-24): a human LP prices inside `[MIN_SPREAD_BPS, TIER_MAX_SPREAD_BPS[tier]]` (merchantStats.ts; enforced in `setSpread`), and `updateMerchantStats` clamps `spread_bps` with `least()` in the SAME statement the tier lands in — no window where a downgraded LP charges a price their tier no longer allows. Provider (`psp`) rows' `spread_bps` remains the platform's corridor take (docs/06).
25. **`settled` (the tier volume gate) is LIFETIME; the reputation RATES are 90-day** (merchantStats.ts `recomputeMerchantStats`). Windowing `settled` would make a rung earned by volume dissolve in a quiet quarter → leverage 8→3 → capacity cut under already-committed float (lock CAS reads leverage from the fresh tier, queries.ts `lockOrder`). `positive_rate` also stays lifetime — `feedback_up` has no timestamp of its own. Dispute bounds live INSIDE `filter(...)` on each table's own timestamp; a WHERE bound turns the left joins inner and drops zero-history merchants.
26. **The cooldown window is a bind param, one fragment, three attach points** (`payeePaidSql`: blocked set, lock CAS, pool view); `PAYEE_COOLDOWN_DAYS` (180 since 2026-08-24) is the only place the number lives. Raising it re-blocks pairs retroactively at deploy. `psp`/sim exemption exists ONLY in `blockedMerchantsForPayee` — lock and pool have no exemption predicate; psp rows are exempt by construction (born locked). Load-bearing, silent.
27. **A reroute must re-alert.** `rerouteOrder` grants a fresh `HEAD_START_MS` and now fires `alertMerchantOrderReady`; before 2026-08-25 the failover LP's head start ticked away against a 3s poller. The head start (5s) is real ONLY because the preferred LP is pushed in the same synchronous pass the clock starts and rivals are DB-blocked from seeing the order until it widens (`listOpenOffers` `offer_widens_at <= now()`).
28. `routeQuality` / `quotes.route_quality` is DEAD OUTPUT — computed (quoteEngine.ts), persisted, on the DTO, read by nothing in any app (verified 2026-08-24, 3 independent greps). Deletion candidate; do not build on it.

29. **Blank vendor credentials are a STATE, not an error.** `config.personaLive` (envConfig) is the
    one switch: provider is 'persona' AND both credentials pass `usableSecret`. `assertKycConfig` may
    only throw for a `persona_sandbox_` key on a production tier — anything else that throws at boot
    turns a variable edit into a crash-loop, which is exactly the bug docs/14 exists to have fixed.
    `KYC_PROVIDER=""` can never express "off": `env()` collapses empty to its fallback, `'persona'`.
    Asserted by `check-kyc-switch.ts` (a process per scenario — envConfig reads env once at load).
30. **Every KYB country spec carries exactly one `identity: true` field, and since 2026-09-03 it is
    `hidden` + `optional`** (kyb.ts; check-kyb asserts exactly one, and that hidden ⇒ optional). PAN/NIK
    were never screened or read by any code and the peer product never asked; the slot stays so asking
    again is deleting one flag. While the vendor is off the reviewer's approval rests on the person as
    described (name, phone, Telegram, the account questions, the screening answers) — docs/14.
    `payoutAccount` is optional the same day (no UTR ↔ account comparison ever existed);
    `accountDedicated` carries the account-freeze question.
31. **Dev-only capabilities gate on `isLocal`, never `isDevelopment`** — and the gate belongs at the
    SELECTOR, not at each caller. `isDevelopment = isStage || isLocal`, and stage is mainnet. Three
    sites had this wrong on 2026-08-29 and each was one word: `/sim/kyc/:tier` (self-promote to tier
    3), `/kyc/verify`'s instant branch (self-promote to tier 2 whenever KYC_PROVIDER was 'sim'), and
    `auth.ts`'s `x-dev-user-id` shim (impersonate ANY user with no token, whenever the Privy vars were
    blank — and blanking a var is now a normal gesture here, per docs/14). Fixing the first and
    calling the class closed is what let the second survive: `getKycProvider()` now returns sim only
    when `isLocal`, so no present or future caller can reach it off-local. The correct alternative
    pattern already existed at `orders.ts` and `money.ts`: `isDevelopment && !isMainnet`.
32. **Every `kyc_tier` gate is PAYER-side.** money.ts (external unhosted sends), crosschain.ts (EVM
    withdrawal), compliance.ts (send + cash-out limits), and `/merchants/apply`. `merchantOps`,
    `routing` and `listRoutableMerchants` read `kyb_status` + `bond_usdc` + `status` and never a tier.
    So raising a partner's tier grants them nothing as a partner and everything as a payer — which is
    why the manual grant was deleted (docs/14). Check this before ever tying a tier to a partner
    action again.
33. **A `transfers` row the DB will credit is verified against the chain BEFORE its status flips**
    (`services/transferVerify.ts`, on both the poller and the Helius webhook): a plain send must parse
    to one SPL transfer of the exact base-unit amount to the recipient's ATA from the sender; an
    `escrow_fund` row (one row, N legs, `to_address` = the escrow POOL's owner) must be that transfer
    to the pool's ATA **carrying the primary leg's reference as an SPL Memo**; an `escrow_release` row
    (ours) is parsed the same way — pool owner as authority, the recipient's ATA, the exact amount.
    Only the bridge legs bypass, by shape. A parsed contradiction fails the row + `risk_events`; an RPC that
    cannot answer returns 'pending' — never fail a real deposit on a bad minute. Status flips are
    gated `status = 'pending'`, so a failed row can never be re-confirmed (docs/15, 2026-08-30).
34. **A settlement (release / refund) is written when it LANDS, not when it is sent** (`settleEscrow`,
    orderMachine.ts): an order with a settlement tx in flight never broadcasts another; a prior pending
    tx younger than `SETTLE_DROPPED_MS` (3 min) is 'in_flight'; older is written off ONLY when
    transaction history has no record of it (`getTransferStatus`) — landed-but-unseen stays in flight
    and is finished by the confirmer; a confirmed settlement row is 'already_settled'. Age alone is not
    a guard (docs/16, replaces the PDA-closed check). The confirmer finishes late landings from the
    transfer row's `note` ('refund' / 'order release'). A deposit the DB never saw is recovered by
    memo — webhook first, `reconcilePoolDeposits` only while a signature-less row waits.
35. **`merchant_bond_events` is written in the SAME STATEMENT as every `bond_usdc` mutation**
    (credit, request, cancel, penalty); for every merchant `bond_usdc = Σ events` (`scripts/check-bond.ts`,
    by hand — DB). `drawDownBond` records what was actually drawn, never the nominal fine (0024).
36. **An exited merchant is frozen by trigger** (`merchants_exited_frozen`, 0024): once
    `suspend_reason = 'exited'`, no writer — `setMerchantStatus`, `decideMerchantKyb`'s CASE, any
    future one — may change `status` or `suspend_reason`; routes map 'merchant_exited' to 409. Exit is
    one statement (`exitMerchant`): the whole bond becomes a withdrawal with `exit = true`, which
    cannot be cancelled. A partner is never deleted (the FKs that cascaded are plain references now).
37. **There is no testnet.** Every tier is mainnet; `isMainnet` / `IS_MAINNET` do not exist. What a tier
    can do is a CAPABILITY derived from config at boot (`escrowLive`, `personaLive`, the stake
    treasury, the EVM minter), each answering 503 when absent — never a cluster flag, never NODE_ENV.
    The faucet, `/sim/orders/*`, the seeded sim LPs, the Sepolia CCTP table and `setup-devnet` are
    deleted, not gated; `listRoutableMerchants` excludes every non-psp `sim_behavior` row in its
    SELECT and the seed creates none (2026-08-30).
38. **The bond floor is collateral, not an entry fee**: `MIN_BOND` $100 = tier-1 `sendPerTx`, tier-1
    `LEVERAGE` 1× (in flight ≤ bond), penalty = `min(bond, order amount)`, and ONE constant
    `DISPUTE_CLAW_WINDOW_H` (72 h) bounds both sides — bond cannot leave while a completed order is
    inside it, and a completed order cannot be disputed after it (read off `order_events`; orders has
    no `completed_at`). Change these together or not at all.
39. **`Escrow`'s on-chain layout changes only with a new program id** (or a version field): the
    2026-08-30 rebuild added `fee` + `platform` and made `Deposit.authority` a signer, safe only because
    the mainnet id is new and holds zero escrows.
40. **Admin reinstate targets `offline`, never `online`** — only the LP's own switch
    (`setMerchantOnlineSelf`) writes `online`, because it is the one that enforces KYB + the bond floor.
41. **Every escrow deposit carries its order reference as an SPL Memo, and is verified against it**
    (`buildUsdcTransfer({ memo })`, `instructionsMove(…, { memo })`, docs/16): one transfer can confirm
    exactly one order. A deposit with no memo, or another order's, never verifies — whatever else matches.
42. **A settlement tx is written off only when older than `SETTLE_DROPPED_MS` AND absent from
    transaction history** (`settleEscrow`); a pool never "closes", so this is the double-payout guard.
43. **Who pays gas is one variable, and the two modes never mix inside a transaction** (docs/16 §Who
    pays gas). `FEE_PAYER_SECRET_KEY` set ⇒ the fee-payer co-signs every user tx and pays every backend tx;
    unset ⇒ sponsored mode: user txs carry NO backend signature (the sender is a placeholder fee payer,
    Privy rewrites it — any signature of ours would be invalidated), the client passes `sponsor: true`,
    a missing recipient token account is created first in its own tx, and the escrow key pays its own
    gas (`gasKeypair()`). `escrowLive` = escrow key ∧ fee destination — the fee-payer is optional;
    `feePayerConfigured` picks the mode. `composeUsdcTransfer` is pure; `check-gas-modes` asserts both
    shapes. Prod's escrow key is Bridge's own.
44. **A deploy gate diffs the range the push MOVED, never `HEAD^..HEAD`** (`scripts/vercel-ignore.mjs`):
    GitHub Actions passes `github.event.before`; Vercel exposes `VERCEL_GIT_PREVIOUS_SHA` (last successful
    deployment of the project + branch) to the ignored build step. A push deploys ONCE, at its tip — read
    against the parent, a docs-last push redeployed the backend and skipped the web build. The parent is the
    fallback only when neither exists (`1587c95`, 2026-08-31).
45. **The Privy app is ONE value on every tier** (2026-08-31): every frontend reads `NEXT_PUBLIC_PRIVY_APP_ID` /
    `_CLIENT_ID` (`EXPO_PUBLIC_` on the phone) bare; the backend reads `PRIVY_APP_ID` / `_APP_SECRET` /
    `_VERIFICATION_KEY` bare — never through `pick()` / `env()`, never with a `bare || STAGE_` fallback. A
    stale prefixed twin must be UNREADABLE: on a stage build `pick()` returns only the `STAGE_` argument, which
    is how stage mailed OTPs from a retired app while the bare var sat on the host unread. Admin had it right
    first (`apps/admin/src/services/envConfig.ts`). Changing the app on a tier is an identity migration: DIDs
    and embedded wallets are per-app; `/auth/sync` adopts by verified email, then OVERWRITES `wallets.address`
    (`queries.ts` upsert) — sweep before flipping (DEPLOY.stage.md §One Privy app).
46. **A gate redirect honours `next` only when `new URL(next, req.url).origin` equals the request origin**
    (`lib/gate.ts` `sameOriginDest`, web + lp byte-for-byte; `check:gate`). A prefix test is an open
    redirect: the WHATWG parser reads `/\evil.com` as protocol-relative. Both branches (right AND wrong key)
    redirect, so both validate. `apps/lp`'s four gate files are copies of `apps/web`'s — change them together.
47. **Every `COPY --from=builder /app/<path>` in `payments/Dockerfile` names a path that exists in the tree**
    (build outputs `node_modules`, `*/dist` excepted) — asserted by `.githooks/pre-push` "Dockerfile copy
    sources". The hook cannot build the image; this is the half it can check. The flat bundle resolves
    runtime files off `import.meta.url`, so vendored IDLs go to `dist/idl`, migrations to `dist/migrations`.
48. **A partner's release address follows the wallet it was declared from** (2026-09-01): inside the
    `/auth/sync` transaction (`upsertUserByPrivyDid`), BEFORE the `wallets` upsert overwrites the address,
    `merchants.treasury_address` is re-pointed to the new wallet wherever it equalled the old one. The stake
    refund already reads the live wallet (`listStakeWithdrawalsAdmin`); releases read the column
    (`queries.ts` order select → `releaseToMerchant`). `/merchants/apply`'s one caller always passes the
    signed-in embedded wallet, so for every human partner the two are one address — a hand-typed treasury
    is left alone, psp rows have no `user_id`, and the exited trigger guards `status`/`suspend_reason` only.
    Any future writer of `wallets.address` must keep this pairing.
49. **A scrolling region is a `ScrollView`, never a `View` with `overflowY`** (2026-09-01): the RN shim puts
    `minHeight: 0` on every View, so a definite-height flex column (anything `flex: 1` under `.app-frame`)
    flex-SHRINKS its children before it lets them overflow — cards crushed to a sliver with their text
    painted over the neighbours, which reads as "two screens on top of each other". `ScrollView`
    (`@fpay/ui/rn`) is a block outer scroller with a flex-column content View (`minHeight: 100%` keeps
    Spacers working). The per-component `flexShrink: 0` on `list`/`search` still protects sheets. The LP
    dashboard's next-step order is guarded by `check:next` (`apps/lp/scripts/check-next-step.ts`).

50. **`users.email` has one canonical form — lowercase, trimmed — and one entrance** (2026-09-01):
    `getLinkedEmail` (services/privy.ts) normalizes, migration 0025 rewrote existing rows and added
    `CHECK (email = lower(btrim(email)))`. Every reader is an exact match (`findUserByEmail`, the adoption
    select, `uq_users_email`) and Privy documents nothing about the casing it returns — one mailbox
    spelled two ways was two accounts. A CHECK, not a `lower(email)` index: the plain unique index stays
    usable by `where email = $1`, and a raw writer fails loudly. The login screens send `normalizeEmail()`
    (`@fpay/shared` email.ts; byte-identical copies in routes/waitlist.ts and landing). (docs/17)
51. **A `/auth/sync` with no handle adopts or asks — it never inserts** (2026-09-01): no handle means
    "adopt the account this Privy-verified email already owns (or re-sync this DID's own row)"; when
    there is nothing to adopt the answer is 400 `handle_required`, decided INSIDE the upsert transaction
    (the route's pre-flight only orders it before the invite gate). Every setup screen (LP FinishSetup,
    web + mobile HandlePrivy) probes first and shows the field only on that code, so a returning person
    is never asked to set up an account they have. `draftHandle` (repair, for your OWN name) is for those
    screens only; anything naming someone else (Send, lookups, admin rename, denylist) uses
    `canonicalHandle` (reject). (docs/17)

52. **Sign-in is published on the TOKEN; the wallet lands on its own clock, and the bridge OWNS
    `walletAddress`** (2026-09-01, docs/18): both bridges run two effects — `ready && user` →
    `getAccessToken()` → handlers → `onSignedIn()` → `load()`; `… && walletsReady` → signer +
    `walletAddress` (unconditional). `load()` writes `me.walletAddress` only while the store's is
    empty; `onSignedIn(address?)` sets it only when given. A `null` token publishes nothing (the 5 s
    fallback → welcome). Every send calls `getActiveSigner()` BEFORE preparing (`wallet_not_found`
    is a code with copy). The handle screen is the one screen that waits for the wallet, bounded by
    the bridge's 15 s `wallet_not_ready`. `bootRoute`/`BootState` untouched.
53. **`no_account` forgets the ACCOUNT, never the SESSION** (2026-09-01): the revoked handler calls
    `forgetAccount()` (logout's reset minus `walletAddress` / `authStatus` / `firstLoadDone`), guarded
    by `onboarded || provisioned`; the same Privy session then reaches the handle screen's adopt-or-ask
    probe (invariant 51). Calling Privy `logout()` here cost every device a second OTP after the DID
    rotation. `walletAddress` must survive: the probe sends it and `/auth/sync` is 400 without one.
54. **Every frontend `fetch(` lives in one of four files** — `packages/app/src/services/api.ts`,
    `apps/lp/src/services/api.ts`, `apps/admin/src/services/api.ts`, `apps/landing/src/lib/waitlist.ts`
    (`scripts/check-fetch.mjs`, in `check:all`). The helpers ask the registered Privy refresher for the
    token on EVERY call (cached copy = fallback; 401 retry = server rejection) and set `content-type`
    only with a body — Fastify parses a DELETE body whenever a content-type is present and 400s an
    empty one before any preHandler (`check:api` in web, lp AND admin). LP's `useWallets()` is read
    WITH `ready`, and a bridge failure there is a toast, never `onSignedOut()`.
55. **The pay sheet is amount → Pay; the wait is a scene** (2026-09-02): no quote button, no review
    sheet. `Amount` quotes 400 ms after the keys go quiet, only while no quote for the current
    amount + rail is live, and refreshes at expiry; `quoteSeq` in the store drops any response whose
    amount moved on, `confirmOrder` orphans in-flight quotes first, `payPayee` clears the quote. Both
    order paths speak `errors.ts` (`payments_unavailable`, `no_merchant`). Between Pay and Paid the
    tracker shows `PayScene` — one of three brand scenes keyed on the order id, two phases
    (`securing` / `sending`), rotating copy — never a step list and never anything LP-aware (21).
    Web motion lives in `globals.css`; native renders the same file static.
56. **A share is a `payment_requests` row with `split_of`; the payer's own part is DERIVED**
    (`amount − Σ shares(open|paid)`), computed in `listTransactionsForUser` (`your_part_usdc`) and
    `getGroupDetail`, enforced only in `replaceShares` under `FOR UPDATE` — never a stored number
    (0026, docs/04 §Trips). A paid share with no `transfer_id` was ticked by hand and is replaced on
    re-split; one a transfer settled survives it and its friend cannot be asked again.
57. **Spend counts OUT rows at their part and IN rows never** — the netting happens once, on the
    source row, so a friend's reimbursement (an IN row carrying `settlesNote`) is never netted
    twice; the one exception is a refunded order (`your_part_usdc = 0`, because the refund is an IN
    `escrow_release` the rule would otherwise ignore). Trip totals exclude settlements and refunds
    (`EXPENSE_SQL`, one fragment, two readers).
58. **`markRequestPaid` verifies the transfer** — the payer's, to the requester, unfailed, ≥ the
    amount — and `uq_payment_requests_transfer` makes reuse unrepresentable (0026). Before this any
    client-supplied id marked any debt paid. Every future "settle" path must keep both halves.
59. **A stake claim never moves `bond_usdc`** (2026-09-02, docs/20): `merchant_stake_claims` is intake +
    a human attribution; admin's credit inserts a PENDING `transfers` row (`from_address` NULL — the
    verifier skips the sender only when a row asserts none, `instructionsMove` `authority?`) and the
    confirmer's chain check + `creditStakeOnConfirm` remain the only path to the credit. The amount is
    read off the chain at submit (`readStakeDeposit`), never typed. One claim per partner per signature
    (`uq_stake_claim_partner_sig`); one LIVE claim per signature (`uq_stake_claim_live_sig`, partial on
    submitted/accepted) so a rejected impostor frees it; a second submission is stored as `duplicate`
    and the admin queue lists duplicates by default. `attachTransferSignature` matches the same
    signature or an unsigned pending row — never re-points a signed row (a confirmed row's signature
    could be freed from the unique index and re-verified on a fresh row: a double credit). The refund
    destination is the partner's (`merchant_stake_withdrawals.payout_address`, `isValidRecipientOwner`
    + `isOperationalAddress`), changeable while open because an exit cannot be cancelled.
60. **An approved partner's edit to a `recheck` field flips `kyb_status` to `submitted` and `status` to
    `offline` in the same statement that computed the diff** (`editMerchantKyb`: prev/diff CTEs over the
    spec's recheck keys, `coalesce(array_agg…, '{}')`, `$2::jsonb`; 2026-09-03). Cosmetic edits save in
    place. `POST /merchants/kyb` accepts `approved` as an EDIT (`KYB_EDITABLE_FROM`), never
    `submitted`/`under_review`. **Hidden spec keys are carried forward server-side and WIN over the
    client** (`{ ...checked.fields, ...pick(stored, hiddenKeys) }` — the mirror validates the full spec,
    so a client-sent hidden value would otherwise override). Events `kyb_edited` / `kyb_edited_recheck`
    carry keys only. The LP form re-seeds `values` on `[merchant?.id, editing]` (a hard refresh seeded
    it blank before). `hidden`/`recheck`/`optional` are asserted mirrored BOTH ways by check-kyb.
61. **No em dashes in any app's prose** (Bridge, 2026-09-03: "dont use emdashes at all… everything
    including admin"). `check-copy.mjs` scans every prose dir + `apps/admin/src` + `packages/shared/src`
    with comments stripped; a comma, period or colon instead, a plain hyphen for an empty cell. En dashes
    stay. `units.ts` is byte-identical in shared and backend (check:money) — change both.
62. **A stake waiver is worth exactly MIN_BOND below the floor, flat, never leveraged, and every bond
    gate reads it** (2026-09-05, 0028, docs/21): `merchants.bond_waived_until` appears as
    `or bond_waived_until > now()` in `listRoutableMerchants`, `setMerchantOnlineSelf`,
    `reinstateBondSuspendedMerchant` and as the flat-floor `case` in `lockOrder`; JS goes through
    `merchantStats.bondCap` (routing `availableOf`, `merchantOps.listWork`, `/me maxFloatUsdc`) and
    `bondWaived` (the tick). check-routing-math asserts all four SQL gates carry it. It never moves
    `bond_usdc`; `drawDownBond` clears it (the first upheld dispute is the stop-loss); the grant
    (`setBondWaiver`) and the reinstate mirror both require an ACTIVE owner, because the user-block
    cascade skips an already-suspended row and leaves `suspend_reason = 'bond'` in place. Root admin
    only (`isRootAdminEmail`), audited `stake_waive` / `stake_waiver_end`, fixed `WAIVER_DAYS` = 30.
    This deliberately re-opens, per partner and on the record, the "zero-stake LP routable" fix of
    invariant 16. `/me` reports `minBondUsdc` 0 while live; the console never names the waiver.
63. **The record is complete at write and the app never rewrites it; the console must SHOW it**
    (2026-09-05, docs/22). A struck quote stores its mid (`quotes.mid_rate`, 4dp, `mid_rate_as_of`;
    null as-of on a set mid = the fallback rate; 0029) and the payer sees the all-in rate only.
    `getMidRate` returns 4dp on both paths so the stored mid IS what priced the order. Every
    settlement transfer that ever touched an order or its legs is reachable from the order: the two
    pointers plus `order_events.detail->>'transferId'` on `settle_dropped`, which `settleEscrow`
    writes for ANY non-confirmed prior at the moment the pointer moves (before this, a row failed
    on-chain or by the verifier was orphaned on the retry). The bulk admin orders list never carries
    a payee (`orderSelect(false)`); the single-order read does. `db/seed.ts` asserts the database
    tier and refuses a database that holds any `transfers` row (no bypass; `db:reset` is the fresh
    path). A search on an admin list writes `ledger_search` with the query's SHAPE, never its value.
    The send note is typed, trimmed and capped at 80 like the split note.

## Danger zones

- `routes/orders.ts` destination regexes — the ONLY gate before a human/PSP acts on a scanned string.
- `payTarget.ts` amount-seeding — a wrong-currency prefill misprices by orders of magnitude (~200×). Any new rail must land its `NUMERIC_CURRENCY` entry + registry row BEFORE or WITH its parse branch.
- `envConfig.num()` silently falls back to defaults (now warns) — an out-of-range env value does NOT fail boot.
- FX sanity bands: a wrong-currency value can be IN-band and plausible (PHP ~61 vs INR ~95) — per-currency `parseRate` + the check-fx cross-currency asserts are the guard.
- `claimOrderPayout` is a CAS — all fiat-leg completion (human, PSP, webhook) must route through it.
- Compliance tier caps convert fiat→USD at the mid — a wrong rate turns the caps into mass 403s.

## Lessons

- Skeptic passes pay: 9 of the draft's framings fell under adversarial verify (see docs/22 changelog), including the architecture direction (currency-from-QR → currency-from-rail) and a live INR dust-order bug.
- `phones.ts` already handles trunk zeros + variable length — don't add phone deps.
- Xendit "one integration, five countries" = code only; each live country needs a local legal entity.
- Singapore (MAS DTSP) is a trap for this business shape; check entity domicile before SG anything.
- A spec that describes the architecture accurately can still be ~half already-shipped: the 2026-08-24 routing spec's lock/redaction/ceiling/reroute sections were DOCUMENTATION of existing code, not work. Verify "what's new" against the tree before sizing the patch.
- A layout bug reported as "screens stacked on top of each other" was flexbox shrinking siblings in a definite-height column — no positioning anywhere. When text overlaps on the web shim, suspect `minHeight: 0` + `flex-shrink` before any z-index or router theory; a screen that had been fine tips over the day it grows one row taller.
- Windowing a count that feeds a threshold changes the threshold's meaning (settled → tier gate). Ask "who else reads this number" before bounding any aggregate.
- "≈ zero" latency arguments must trace WHO gets pushed vs who polls, and whether the clock and the push start in the same pass — the 5s head-start claim fell 3-0 on exactly that.
- A metric with no consumer (routeQuality) can still distort a plan if the plan assumes it matters; grep consumers before defending an output.
- **A reference someone links may already be IN the tree.** The p2p.me merchant form Bridge pointed at
  was ported months earlier as `kyb.ts` SCREENING, field for field, with a review queue. Grep the repo
  for the peer product's actual questions before sizing "build this form" as new work.
- **Ask what the chosen SCOPE deletes, before designing.** All three explorer lenses proposed a
  parallel manual-KYC subsystem. Scoping the fallback to LP applicants only collapsed the entire need:
  those users already fill in a form a human already reviews in a queue that already exists. The
  scoping answer arrived before the design and still nearly got designed around.
- Two changes landing in one handler (approve a business / grant a tier) need the audit row and the
  confirm dialog to name BOTH — or better, don't land two changes in one handler.
- **Audit the thing you just shipped, against the code, before it settles.** The manual-onboarding
  change was well-reasoned and its central mechanism was still wrong: it granted a tier that bought
  its recipient nothing. Six downstream problems existed only to support that one unnecessary write.
  Ask "what does this actually unlock, at every gate that reads it?" and enumerate them — the answer
  took one grep and overturned a decision two rounds of planning had agreed on.
- **Refute the plan, not the constants it changes.** Round-2 Opus A "refuted" the tier-1 collateral
  claim by quoting `LEVERAGE[1] = 3` and `MIN_BOND = 2000` — the very values the plan sets to 1 and 100.
  A skeptic prompt must say "PROPOSED state; do not refute by quoting the current value of what is
  being changed", or a third of the panel is spent re-reading the diff's left-hand side.
- **A skeptic can be wrong with a citation.** The "split-refund bug in getOrderPlatformFee" came with
  a `file:line` and was inverted: `groupId: i === 0 ? null : primaryId` makes the PRIMARY leg the
  `group_id is null` one. Grounding outranks a confident refutation too — re-open the line before
  deleting a claim, exactly as before adding one.
- **The chokepoint is the STATUS FLIP, not the consumer.** Two planning rounds placed the on-chain
  check inside `onTransferConfirmed`; the bond credit lives in the `AndNotify` wrapper around it and
  would have run unguarded. When the fix is "verify before X", find the write that makes X true, not
  the function whose name says X.
- **`sim_behavior='happy'` rows in a check harness are routing fixtures** — `check-merchant.ts`
  ranked seeded sim rows through `rankMerchants`; the moment routing excluded sim rows the harness
  went blind. Fixtures that go through a hard filter must be shaped like what passes it.
- **`git ls-files` from a subdirectory lists that subtree only.** The Dockerfile "did not exist"
  because the git root is `payments/`, one level above `monorepo/`; `git rev-parse --show-toplevel`
  first.
- **A half-fixed bug class is more dangerous than an unfixed one**, because the commit message says it
  is closed. Locking `/sim/kyc/:tier` and declaring the sim-on-stage doctrine moot left the identical
  hole one route over, and the next reader had a written reason not to look.

- **A component removed is a set of guarantees to re-implement, not a file to delete** (2026-08-31). The
  escrow PDA was doing two jobs nobody had named — binding one deposit to one order by seed, and making a
  second payout impossible by being closed. Swapping it for a pooled key looked like "delete the client";
  the skeptics found both jobs missing. Before removing anything that holds money, list what it silently
  guarantees and where each guarantee goes.
- **"Our own signature" is not proof** (2026-08-31). `needsChainCheck` skipped rows we signed; under a pool
  that made every payout a fact only our DB asserted. Verify outbound rows exactly like inbound ones.
- **Price a deploy as rent vs sunk, in today's SOL, before calling it expensive** (2026-08-31). "$300 for a
  program" was ~$213 refundable + ~$2–3 sunk; the decision still went the other way, but on custody and
  the client's real shape — not on a number that was wrong.
- **A fix that isn't on `origin/*` isn't a fix** (2026-08-31). "Prod still asks for KYC" was answered by one
  `git log origin/stage..stage` (27 unpushed commits, every KYC-lift among them); three lenses then spent their
  budget confirming it. For any "still happening on a deployed tier" report, check the remote before reading source.
- **A deploy gate that judges the tip commit turns "commit docs last" into "deploy nothing"** (2026-08-31).
  `vercel-ignore.mjs` read `HEAD^..HEAD` on Vercel believing Vercel deploys every commit; a push deploys once.
  Its `--check` self-test covers `shouldBuild` and could never catch a wrong base — test the range, not just the rules.
- **The plan's own fix can be the vulnerability** (2026-08-31). Draft v2 proposed `next.startsWith('/') &&
  !next.startsWith('//')` for the gate redirect; the critique round reproduced `/\evil.com` → `https://evil.com/`
  in Node. Verify a security-shaped fix the way you verify a claim — run the counterexample — before shipping.
- **Line numbers drift between agent reads** — three sessions commit to this tree in one evening; anchor doc
  edits by quoted text and assert the match, never by `sed -n 373p` (L3's 373 was my 369 an hour earlier).
- **Prose is not a gate** (2026-08-31, night). `.githooks/pre-push` said in its header for weeks that it
  never builds the Dockerfile; the shelving commit deleted `src/idl`, the Dockerfile still copied it, every
  local gate passed, and the stage image failed AFTER the push — the backend stayed on the old Privy app
  while Vercel shipped the new frontends (a 401 window). A deletion commit must be checked against every
  consumer of the path, including ones outside the monorepo (`payments/Dockerfile`); the hook now asserts
  COPY sources exist (`c1`… see decision log). When a gate admits a gap in a comment, close the cheap half.
- **"Existing users only", enforced by a DID lookup, is a rule the console cannot repair the day identities
  rotate** (2026-09-01). The LP console's "You need an fpay account first" was a posture for a year of
  stable DIDs; the one-Privy-app flip changed every DID overnight and the same screen locked out every
  existing partner, with "sign into web once" — the payer app's gate key — as the only way in. A dead end
  that names another app is a lockout waiting for a migration. Also: the fix the critique round killed was
  the plan's own guard (a mismatch banner) — when the stale value is an address nobody can sign from, a
  banner guards nothing; put the fix where the value changes (the sync txn), not where it is displayed.

- **"Nothing can tell the two apart before the call" is a claim to check against the request, not
  the response** (2026-09-01). The morning's FinishSetup asked every returning partner for a handle because
  adoption was decided inside the sync; the verified email — already fetched on the same call — told the
  two apart the whole time. When a screen asks for something the server then discards, look for the fact
  the server used instead and let the client ask for THAT first (here: a sync with no handle).
- **Two sessions, one day, one migration number** (2026-09-02). Trips took `0026` and docs/19 between
  this plan's first `ls migrations/` and its first commit; the migrator keys applied rows by the numeric
  prefix, so the second `0026` would have been applied-or-skipped by whichever ran first. `ls` the
  directory the moment before creating a migration AND before committing it; same for `docs/NN`. Line
  numbers drifting ~300 in `queries.ts` mid-session was the tell that someone else was landing work.
- **A skeptic can be wrong with a citation, again** (2026-09-02). Round 2 refuted `uq_stake_withdrawal_open`
  as non-existent by reading 0024 only; it is in 0014:93. Grounding outranked it — the conclusion
  (cancel + re-request works) held either way, but the stated reason was false.
- **"Exactly one" is a claim about the world, not the code** (2026-09-02). "Exactly one SPL transfer in the
  tx" was refuted by how exchanges batch withdrawals; scoping to "into the treasury ATA" fixed the reader,
  and the residual (two partners in one batch) is a ceiling of `transfers.signature unique` — named, with
  its own error code, not solved.
- **`open(path, 'w')` runs before the function that reads `path`** (2026-09-01). One line —
  `open(p,'w').write(apply(p))` — truncated `.prism/project-model.md` to zero bytes when `apply` raised,
  during a window where a concurrent session had just committed invariant 49 (`f99325f`, seconds
  earlier — had it still been uncommitted, its 8 lines would have been gone). Read into a variable first,
  transform, assert, THEN open for writing; and before editing a file another live session has uncommitted
  hunks in, copy its current content to disk.

- **A check that is not in `check:all` does not exist** (2026-09-01). `check:boot` had been red for
  weeks (it asserted the funding step, deleted with the testnet) and nobody knew — it was defined in
  `apps/web/package.json` and never wired into the root. When adding a `check:*`, the root entry IS
  the deliverable; the script alone is a file.
- **"Fixed it in the other app" is a grep, not a memory** (2026-09-01). Web's bridge fixed the
  `useWallets().ready` gate and wrote a comment describing the exact bug; LP's bridge — "a trimmed
  sibling of apps/web's" — still had it, and it was the provider app's whole logout complaint. When
  a bug is fixed in one of twin files, grep the twin for the same line the same day.
- **The critic's remedy can be the next bug — twice** (2026-09-01). Round 1's `sessionFound` flag
  and round 2's "only-if-empty" address rule were both plausible and both refuted by the next reader
  with a concrete sequence (six call sites + no mobile watchdog; a retained server address the
  signer cannot sign for). For an auth-path change, a second narrow round on the NEW design alone
  paid for itself; the split shipped with four corrections and no state added.

- **A critique's remedy is a claim too; fix at the ORPHAN site, not the failure site** (2026-09-05).
  Round 1's `settle_failed` event at the on-chain-failure line would have missed the confirmer's
  verifier path (invariant 33 fails a row with no event). Naming the row where the pointer LEAVES it
  (`settleEscrow`'s retry) covered every writer, present and future, with one branch and no new
  event name. Same shape as the 2026-08-30 "chokepoint is the status flip" lesson: find the write
  that makes the row unreachable, not the write that makes it bad.
- **"Recoverable from stored fields" needs the arithmetic, per currency** (2026-09-05). The mid rate
  looked derivable from rate + spread + fee; the inversion interval is `1e-6 · lpRate² / amountFiat`
  against a 1e-4 grid, unique for INR at normal sizes and five-way ambiguous for 500,000 IDR. A
  low-decimal currency turns a "derived" number into a guess. Store the input.
- **A seed script is a delete path** (2026-09-05). "No writer mutates the ledger" was true of the app
  and false of `db/seed.ts`, which wiped every money table with no tier check while local dev points
  at stage. Grep `delete from` in `src/db`, not only in `queries.ts`, before claiming immutability.

## Counsel flags & open questions (from 2026-08-24 routing plan — for prism-retro)
- FLAG-1: the pair rule has TWO recorded rationales (LP bank-freeze protection, docs/06 §pair rule; payee data-minimisation, docs/06 §privacy). Under the second, lock→see VPA→unlock→re-lock is a harvesting path (unlock is penalty-free and writes no `lock_expired`). Counsel decides which governs; that decides whether A3 gets fixed.
- FLAG-2: a forced split is "one payment, ≤3 source accounts, one receiver, same day" — deliberately generated. Explainability question for counsel; per-leg cooldown holds in code.
- Unverified: is the compliance cash-out cap checked per PAYMENT or per LEG? If per-leg, splits multiply a payer's effective cap. Check before real-money scale.
- Open: real `TIER_MAX_SPREAD_BPS` values (placeholders 100/200/300 shipped); a feedback timestamp column (so `positive_rate` can window); check-lock has no CI story (invariant 10 keeps check:all no-DB); no distinct payer-facing error for `no_merchant` (bare 503); A2 coverage-DoS via min-size live orders; A7 lock churn writes no attempt rows so "max 3 attempts" is bounded only by `expires_at`.
- Open (2026-08-31, Privy/gate plan): which Privy app survives (assumed admin's `cmsozz…`; the retired stage
  app is `cmqm9n…`); whether any stage embedded wallet under the retired app holds USDC (sweep before the
  flip); same `STAGE_ACCESS_KEY` value on lp as web or its own; does lp get a prod Vercel project (DEPLOY.md
  now lists one, TBD); Gas Sponsorship → Solana ON on the survivor app before any deploy; lp is the first
  middleware under include-outside-root ON — budget one failed deploy.
- Open (2026-09-01, LP self-signup plan): Q1 house codes for recruits (assumed) vs loosening the invite gate
  product-wide for the pilot (both apps sit behind ACCESS_KEY); Q2 whether any partner holds USDC at a
  retired-app embedded wallet (the treasury re-point moves future releases, not past ones); whether any
  partner adopted via web before the re-point shipped (then the one-time SQL in DEPLOY.stage.md §One Privy
  app); the admin console keeps the identical dead end (`Providers.tsx` 'absent') — root admins are exempt
  from invites, so the same screen would work there; `docs/08:88-91` still says KYB approval grants tier 2
  (removed 2026-08-29, invariant 32) — stale, not fixed here.

- Open (2026-09-01, handle+email plan): which admin screen Bridge was on (assumed the handle-only pages;
  if the Users table showed `—`, that is an unsynced row); migration 0025 is Bridge's — its guard raises
  with a count if stage holds one mailbox spelled two ways; any raw denylist handle rows
  (`value !~ '^@[a-z0-9_.]{3,30}$'`); a Privy read failure during the probe still makes a returning
  partner look new (pre-existing); the DID-rotation web dead end is fixed by the same probe — confirm on
  stage that a rotated payer lands on Home without typing.

- Open (2026-09-05, admin ledger plan, docs/22): Q1 "all transactions" taken literally (plain sends
  and adds on the Transactions page) vs the per-payment record only; Q2 whether admin needs a
  per-partner bond ledger beyond the draw on the order page and the 90-day upheld count; Q3 the
  docs/08 retention placeholder ("financial records 5 years from completion, contact PII 12 months
  after soft-delete") is intent, not a compliance claim: keep, change, or stay silent. Deferred with
  triggers: CSV export (a written external request), evidence upload (a screenshot decides a
  dispute), LP-typed paid amount (a short-pay dispute), admin read rate limits / tiered roles (more
  than a handful of admins), nav-global search, `transfers.order_id`, raw QR payload, a note field
  on `Confirm`. Assumed: one FX source per deploy (no source column); Bridge is the adjudicator.

## Decision log

- 2026-08-10 · **Indonesia corridor enabled** as currency-generalization keyed off the rails registry; sim LPs + key-gated Xendit test-mode payout seam; Philippines designated fast-follow; Singapore avoided. Open questions: Xendit schema verify-on-first-run, QRIS real-sample validation, docs/11 Indonesia section.
- 2026-08-11 · **Per-corridor settlement models adopted** (`lp` vs `provider`; the choice is an entity/licensing commitment) with a DB payout-provider registry (rows = routing metadata; creds = env; priority+failover with raw-status discipline) and the platform-settlement-row mechanism — `merchant_id NULL` rejected under adversarial verify (4 subsystem breaks incl. deleted payer recourse) → docs/23-settlement-models-and-provider-registry.md. Open: float model (prefund vs vendor-converts), charge-the-flat-fee, per-model order floor, THB timing, REVERSED auto-resolution, cross-account idempotency scope (unverified). All work on `stage` branch (stage→stage env, sacred→prod).
- 2026-08-14 · **LP marketplace: offer → lock → pay → release** (plan:
  `~/.claude/plans/merchant-side-of-app-distributed-dahl.md`; 6 phases, P1–P3 shipped). Staged
  broadcast with the lock as a `merchant_id` transfer (no offers table, invariant 14 intact);
  head start = the reputation reward; spread-ceiling filter = how speed pays without a bonus
  system. Corridors gained an ordered `settle` preference (provider-first, LP fallback) resolved
  through the provider registry, not a DB row — so UPI flips the day an India partner is enabled.
  `merchants.country` hard-filters the pool. Alerts are an adapter seam (Telegram now, FCM/APNs
  when mobile returns); web push rejected for now because SwKiller.tsx removes service workers.
  Fixed live: zero-stake LPs were routable for ~80s after approval; float was unbounded by bond.
  **Open**: migrations 0014/0015 unapplied (shared stage DB — Bridge runs `yarn db:migrate`);
  `check:rails` is RED at HEAD because its fix sits in a file another session is also editing;
  P4 (KYB evidence), P5 (warmth/hour-of-week routing), P6 (tiering, LP earnings, dispute view)
  not started; payer's in-flight order still not persisted across refresh (blocked on the same
  shared `usePayStore.ts`). Cut deliberately: shortened dispute window for high-tier LPs (trades
  payer protection for LP throughput — wrong side of that trade).
- 2026-08-13 · **Admin user moderation shipped** (handle renames admin-ONLY — users still can't self-change; display-name edits; suspend/reinstate with mandatory reason) — freed handles release INSTANTLY, Bridge's explicit accepted risk ("you have to manage your username"). Suspension = one gate in authPreHandler (admins exempt) + resolve-time receive-block + one-way merchant cascade; audit note `@old -> @new; reason` is the sole post-release history disambiguator → docs/24-admin-user-moderation.md. Cut-but-mandatory-later: recipient pinning + request-payment binding to `from_user_id` BEFORE self-service handle changes ever ship. Open for retro: does support need read-only access for suspended users; request-pay staleness window.
- 2026-08-24/25 · **Routing V1 rebalance shipped** (plan: `~/.claude/plans/linear-wondering-raccoon.md`;
  8 commits `1356d03`…`1569acc` on `stage`, unpushed). Cooldown 90→180d + partial index (0023);
  head start 20s→5s + reroute now re-alerts (bug found by the skeptic panel); weights
  .30/.14/.14/.10/.12/.08/.08/.04 (cost trimmed not floored — the payer's rate is a pure function
  of the struck spread with no rebate, so cost is the only payer-protecting signal; warm NOT raised
  — it measures a polling tab); reputation rates 90d with `settled` + `positive_rate` lifetime;
  **tier-priced spreads** (Bridge mid-loop: "the tier based prices we do set up" → per-tier caps,
  least()-clamped in the stats write); routing_* counters + `GET /admin/lp-activity` (Bridge: the
  summed histogram is the corridor's probabilistic capacity-by-hour). Spec items DROPPED with
  evidence: new RoutingAudit table (`order_routing_attempts` exists), 0.5-neutral normalize
  (routeQuality is dead output). Fleet: 8 lenses, 22/22 facts grounded, 4 claims × 3 skeptics
  (C1 settled/tier-gate + C4 no-rebate SURVIVED 3-0; C2 routeQuality-impact + C3 "5s≈zero"
  REFUTED 3-0 — both draft recommendations reversed). Divergence 0.71. Bridge's manual steps:
  `yarn db:migrate` (0023), real tier-cap numbers, push on ack.

- 2026-08-29 · **Manual partner onboarding while the identity vendor is dark** (plan:
  `~/.claude/plans/sparkling-growing-lagoon.md`; 6 code commits + 1 docs commit on `stage`,
  unpushed → docs/14-manual-onboarding-fallback.md). Persona has no production key, `/merchants/apply`
  required tier 2, and only Persona granted tier 2 — the partner funnel was shut. **Rejected** a
  parallel manual-KYC subsystem (new provider + `users.kyc_fields` + second admin queue + new sheet),
  which all three explorer lenses independently proposed: with the manual path scoped to LP applicants
  only, everyone who needs it is already filling in the 13-field KYB form that a human already reads
  in a queue that already exists. Shipped instead: `config.personaLive` as the one switch, the boot
  assert degraded, `/kyc/verify` 503ing before the network call, the apply gate keyed off the switch,
  `identity: true` on the KYB spec (+ NIK for Indonesia), and the KYB approval granting tier 2 with
  `kyc_provider='manual'` provenance. Found on the way and fixed: the reconciler aborted a whole pass
  on one bad session, `/sim/kyc/:tier` answered on mainnet stage, and the LP console watched for the
  previous vendor's return param so its Persona return never polled. **No migration** —
  `merchants.kyb_fields` is jsonb and `users.kyc_provider` already existed.
  **Open for retro:** (1) the `kyc_provider='manual'` re-verification sweep is owed and automated by
  nothing; (2) tier 2 raising manual users' own payer limits ($100→$1,000/tx) is unwanted exposure —
  the cheap close is a fourth KYC_TIERS row, not a new gate per call site; (3) is the compliance
  cash-out cap per PAYMENT or per LEG (still unverified, inherited from the routing plan).

- 2026-08-29 (second pass) · **Audit of the manual-onboarding change; the tier grant deleted** (plan:
  `~/.claude/plans/sparkling-growing-lagoon.md`; 7 commits `636cc52`…`6b4ffa3` on `stage`, unpushed).
  Three adversarial lenses over the diff; 6 claims grounded by re-reading source, 0 struck. The
  headline overturned the change's own central mechanism — see invariant 32. **Fixed:** sim
  unreachable off-local at the selector (it was still reachable on mainnet stage via `/kyc/verify`);
  the `x-dev-user-id` shim gated on `isLocal` (blanking a Privy var on stage was a no-token
  impersonation endpoint); the KYB tier grant deleted; `isMerchantTreasuryAddress` filtered to
  approved rows (one unreviewed application blocked every send to any address it named); the LP
  console re-reads the switch on the two screens that branch on it; the payer app stops offering a
  CTA that can only 503; `usableSecret` checks the credential prefix. Docs 02/06/07/11/14 corrected
  against the code on ten specific disagreements (`FP-` vs `FREN`, tier-2-to-apply stated as
  unconditional, "no rail refuses LPs" when two do, `users.status` deletion "TBD" when 0012 shipped
  it, five filters that are seven).
  **Open for retro:** (1) `appendKybEvent` can still throw between the CAS and the audit row, leaving
  a decided merchant with no timeline entry and an unretryable 409 — pre-existing, needs a
  transaction, deliberately not done here; (2) `POST /admin/merchants/:id/status` remains the one
  admin write with no state guard, no row check and no reason; (3) there is still no route that can
  LOWER a kyc_tier, which is fine now that nothing grants one manually but will matter the first time
  a vendor declines someone already approved; (4) is the compliance cash-out cap per PAYMENT or per
  LEG (still unverified, inherited from the routing plan).

- 2026-08-30 · **Closed pilot: escrow to mainnet, the chain asked before any row flips, and a bond
  system that functions** (plan: `~/.claude/plans/i-scanned-and-tried-witty-sky.md` → docs/15;
  11 commits `7f18793`…`95bcf74` on `stage`, unpushed). Bridge, mid-plan: "we have removed KYC
  entirely… cap currently is $100 as per the tier", then "the bond thing… they have to stake only
  $100–$300… two different wallets… store what user has staked… don't delete, mark or flag", then
  "we don't have testnet at all anymore… remove those." Shipped: the KYC tier gates lift while the
  identity vendor is off (`effectiveLimits`, `identityCheckAvailable`); `isMainnet` retired with
  everything only a testnet made safe (faucet, `/sim/orders/*`, sim LPs, Sepolia table, devnet
  setup); `transferVerify.ts` (invariant 33) + `check-transfer-verify` 12/12; `settleEscrow` +
  `reconcileFundedVaults` (34); 0024 bond ledger + trigger + exit + claw window (35, 36, 38);
  admin release route (root-only, record-only) + console; LP exit, disclosure copy, prompt terms;
  the escrow program rebuilt (`authority: Signer`, fee inside the escrow, `platform_ata` on release,
  8 tests) pending Bridge's keypair + `anchor test` + deploy. **Blocked on another session's dirty
  `apps/backend/src/envConfig.ts`:** `escrowLive`, `platformFeeDestination`, the `USDC_MINT` default,
  the `orders.ts:67/:117` gate, the escrow client's fee-split changes, `check-escrow-switch`.
  **Bridge's hands:** program keypair + backup, `anchor build`/`test`/deploy (~2.5 SOL), two cold
  wallets, Railway vars, `yarn db:migrate` (0024), revoke the 5 live invite codes, push on ack.
  **Open for retro:** post-completion disputes still cannot pay the payer (only fine); no Telegram, so
  the LP is a polling tab; re-application after exit; counsel on India settlement, stake custody,
  PAN retention after exit; whether the 72 h claw window is the number; `settleEscrow` blocks a
  worker tick up to 60 s per settling order.

- 2026-08-31 · **The escrow program is audited and SHELVED; the pilot's escrow is a backend-held pool** under a dedicated key (`ESCROW_SECRET_KEY`, no SOL; fee-payer pays gas) — Bridge: "Backend key, program later." Audit: CRITICAL dust-lock (`close_account` needs a zero balance; anyone can dust a vault), HIGH refund-to-anyone, upgrade-authority dominance; the deploy was a refundable ~2.07 SOL with ~$2–3 sunk, not "$300". The PDA's two silent jobs are re-implemented explicitly: attribution = an SPL Memo with the order reference, required by the verifier; idempotency = a settlement is written off only when 3 min old AND absent from tx history. Recovery is webhook-first (Helius pushes every fee-payer-signed tx; unknown signature → memo → attach), the poller reads pool history only while a signature-less row waits. Our own `escrow_release` rows are chain-parsed. `escrowLive` = escrow key ∧ fee-payer ∧ fee destination. Prod's escrow key is Bridge's own (DEPLOY.md §Keys); stage's is `5w9H…vWUR`. → `docs/16-escrow-pool-and-the-shelved-program.md`

- 2026-08-31 (later) · **Who pays gas is one variable — the fee-payer is optional.** Bridge: "we keep both, but currently only Privy directly does it; we don't have a fee payer right now." Grounded first: nothing in the code asked Privy to sponsor (every user tx was fee-payer-signed; no fee-payer ⇒ 503 on every send). Now `feePayerConfigured` picks the mode: set ⇒ as before; unset ⇒ sponsored mode — user txs built unsigned with the sender as placeholder fee payer, web passes `sponsor: true` (Privy rewrites fee payer + blockhash), a missing recipient token account is created first in its own tx, the escrow key pays its own gas (`gasKeypair()`), Helius watches the pool's token account, mobile refuses with copy (Expo SDK cannot sponsor). `escrowLive` no longer needs the fee-payer. Invariant 43 rewritten; `check-gas-modes` asserts both shapes offline. Three stage falsifiers recorded in docs/16 (S1 placeholder accepted, S2 TEE wallets, S3 Helius token-account match). → `docs/16 §Who pays gas`

- 2026-08-31 (evening) · **app.frenspay.xyz "still asks for KYC / no transactions" — the fix had never left the
  laptop** (plan: `~/.claude/plans/app-frenspay-xyz-main-app-is-sorted-teapot.md`). `origin/stage` and
  `origin/sacred` sat at PR #17, before every KYC-lift commit; prod additionally 503'd every quote/order on the
  retired `isMainnet` switch (sacred `orders.ts:67/:117`) and its client sent every tier-<2 payer into a dead-end
  verify sheet (sacred `store.ts:917`). Live probe: both APIs 200 on Railway — prod IS wired; DEPLOY.md/docs/10
  said otherwise (corrected `f47c7d2`); the 401 on app.frenspay.xyz is our own invite gate. The critique round
  found the Vercel gate diffing `HEAD^..HEAD` — a docs-last multi-commit push would have shipped the backend and
  skipped the web build (fixed `1587c95`, invariant 44). Deploy is Bridge's: pool vars per tier
  (`ESCROW_SECRET_KEY`, `PLATFORM_FEE_DESTINATION`, `STAKE_TREASURY_ADDRESS`; `KYC_PROVIDER` unset), one
  approved ≥$100-bonded online UPI partner per tier (else 503 `no_merchant`), push stage → soak → PR stage→sacred
  (runs 0024 on prod at boot; "Create a merge commit"). **Open for retro:** did Vercel BUILD (not "skipped by
  ignore command") on the first stage push; fee-payer vs sponsored on prod; raw `payments_unavailable` copy (closed 2026-09-02, invariant 55);
  `smallestTierFor` still advertising tier 2 with the vendor off.

- 2026-08-31 (night) · **One Privy app on every tier; the LP console behind the deploy gate** (plan:
  `~/.claude/plans/provider-merchant-access-key-thing-is-humming-tide.md`; commits `1ab4293` `5eec785`
  `f906501` + docs, on `stage`, unpushed). Bridge: "the OTP is still coming from the stage privy app id, which
  we are no longer using anywhere at all… same privy is used everywhere" + "Provider/Merchant ACCESS_KEY thing
  is missing". Code cause, not host: `pick()` on stage returns only the `STAGE_` argument. Shipped: bare Privy
  names in web/lp/mobile/backend (admin's pattern), boot log `privy=`, no fallback (invariant 45); web's gate
  lands the device on the path it asked for, origin-checked on both branches (invariant 46; `check:gate` 10
  cases, in check:all); lp gains byte-for-byte copies + `ACCESS_KEY`; ~40 doc anchors incl. a new
  `DEPLOY.stage.md §One Privy app` migration note. The critique round REFUTED the draft's own `next` guard
  (open redirect) and its "backend first or duplicate rows" ordering (a mismatched backend is a plain 401 —
  one push is shortest); cut mobile `loginMethods` (not in the Expo SDK's config type), a `@fpay/shared/tokens`
  subpath import, an LP README. Bridge's hands: confirm the survivor app + sweep old embedded wallets;
  dashboard (origins, email-only, Solana wallets, Gas Sponsorship ON); host vars incl. lp `STAGE_ACCESS_KEY`;
  one push. **Post-push (same night):** Bridge pushed; the backend image failed on a stale
  `COPY …/src/idl` (deleted with the program in `56be186`); hotfix removes it, copies the CCTP IDLs to
  `dist/idl` where the flat bundle reads them, and the pre-push hook now asserts every Dockerfile copy
  source exists (invariant 47).

- 2026-09-01 · **The LP console finishes account setup itself; the release address follows the wallet on
  adoption** (plan: `~/.claude/plans/provider-side-issue-you-spicy-snowglobe.md`; on `stage`, unpushed).
  Bridge: "provider side issue, you need an fpay account first. no, why??" Grounded first: the dead end
  (`AuthGate.tsx`) fired on 401 `no_account`, the console never called `/auth/sync`, and the one-Privy-app
  flip had rotated every DID — so EXISTING partners were locked out and the documented workaround
  (`DEPLOY.stage.md`) was the payer app's gate key. Shipped: `FinishSetup` in the console (handle; invite
  field only after 403 `invite_required`/`invalid_invite`; adoption → "Welcome back, @old") calling the
  existing `/auth/sync`; six error-copy entries; ONE backend statement re-pointing
  `merchants.treasury_address` in the sync txn (invariant 48); comments in five files; docs/11 §Who can use
  it + DEPLOY.stage.md §One Privy app. **Rejected** with evidence: "partners skip invites" (no
  server-verifiable LP fact at sync time — one Privy app, gate cookie never reaches the API — so a body flag
  is an open signup that also mints 3 codes per account, and `check-invites` says "nothing else may skip the
  gate"; the existing carve-out is an admin-minted HOUSE code); a mismatch banner (the critic: it cannot make
  a release spendable); auto-deriving the handle (immutable, payer-resolvable, would publish the email
  localpart). Found on the way: `POST /waitlist` burns the same codes — hand recruits the code WITH the
  console link. Bridge's hands: mint house codes; one-time treasury SQL only if someone adopted via web
  first; push on ack.

- 2026-09-01 (afternoon) · **Handle + email named together, one rule per input, adopt before you ask**
  (plan: `~/.claude/plans/on-admin-side-i-cheeky-ullman.md` → docs/17; on `stage`, unpushed). Bridge:
  "on admin side I don't see user's email and their username together… regex check on username, trimming…
  same for email… on inputs" + "same email is used for fpay account, so if merchant is already there, we
  don't need to ask for fpay account again." Grounded first: the Users table already showed both (on
  origin/stage AND sacred) — every OTHER admin page named a user by handle alone and Merchants showed
  neither; handles were already canonical on every backend write (the client had three pasted repair
  regexes); email was the real gap — Privy → DB verbatim, case-sensitive unique index by explicit bet,
  Privy's docs silent on casing; and the morning's LP `FinishSetup` asked every returning partner for a
  handle that adoption then discarded. Shipped: `/auth/sync` without a handle adopts-or-asks (invariant
  51, in-tx, TOCTOU closed); the three setup screens probe first; `getLinkedEmail` normalizes + 0025 +
  CHECK (invariant 50); `@fpay/shared` `email.ts` + `draftHandle` (+ 7 asserts in check-paytarget);
  admin `Who` cell (handle over email) on dashboard/orders/risk/audit + a Merchants "Account" column
  with `userEmail`/`adminEmail`/`ownerEmail` on the DTOs; denylist handles stored canonical (a raw
  'Bridge' was a sanctions row nothing could hit); `{"handle":1}` no longer a 500; invite audit names the
  matched owner. The critic REFUTED two draft claims: "the on-conflict path never reads the handle" (the
  INSERT VALUES does — fixed by resolving it in-tx) and `draftHandle` on the admin inputs (a sanctions
  field must reject, not repair). Rejected: `/me` adopting (no wallet for invariants 45/48), a
  `lower(email)` index (unusable by exact-match readers), deriving the handle (rejected that morning).
  Bridge's hands: `yarn db:migrate` (0025) after the push; push on ack.

- Open (2026-09-01, sessions/boot plan): which tier(s) the OTP loops were reported on (prod needs
  `stage → sacred` first — it lacks invariant 51's probe, so the second login dead-ends on the handle
  screen there); Home is reachable a few seconds before the wallet (a Send in that window says
  `wallet_not_found`); the 15 s wallet bound + reload is specified, not yet seen on a device; B2
  rests on Fastify's source, not a live `curl -X DELETE`; admin's prod switch needs Bridge's three
  config steps (all in DEPLOY.md/DEPLOY.stage.md already).

- 2026-09-01 (evening) · **Sessions and boot: the OTP loops, the token on every call, the chain split**
  (plan: `~/.claude/plans/logout-is-an-issue-humble-bear.md` → docs/18; commits `26f8558` `0d10bc1`
  `ae7734f` `00dda6e` `d5c078e` + docs, on `stage`, unpushed). Bridge: "logout is an issue… OTP all
  the time… provider app, main app, other apps" + "make api one main constant… tokens on every
  call… make this a rule" + "admin side switch modes" + "reduce splash screen time". Grounded first:
  nothing was unpushed. Four causes: LP read `useWallets()` without `ready` → createWallet threw →
  blanket catch → SignIn on every cold return (the un-fixed twin of web's own fix); `no_account` →
  Privy `logout()` cost every device a second OTP after the DID rotation; the 5 s fallback + the
  wallet-iframe wait showed welcome to signed-in users (and WAS the splash); admin has no logout path
  and its switch already exists (config only). Shipped: LP `walletsReady` + toast; `forgetAccount()`
  (53); the bridge chain split (52) with the signer-before-prepare reorder and `wallet_not_found`;
  per-call token in the three helpers; admin's content-type bug (two DELETEs 400'd since they shipped)
  + `check:api:admin`; `check:fetch` (54); `check:boot` wired + fixed; mobile `PrivyRoot` mounts on
  hydration, not fonts; LP `/me ∥ /balance`. **Refuted by the critics and dropped:** `forgetAccount`
  clearing `walletAddress` (400 `missing_fields`); a `sessionFound` router flag (skeleton-only win,
  six call sites, mobile has no watchdog); an async icon-font link (every icon hidden); "only if
  empty" address write (the signer can't sign the retained one); `signedIn` on a null token. Not
  built: a shared request core / `useApi()`, admin self-adopting via `/auth/sync` (no wallet).
  Bridge's hands: push on ack; merge stage → sacred for prod; admin prod config; a device run.

- 2026-09-02 · **The partner form asks about a person, not a business** (plan:
  `~/.claude/plans/it-is-not-necessary-steady-galaxy.md`; quick mode, no fleet — Bridge: "please dont go
  wild and wide"). Bridge: "it is not necessary that a provider/merchant has a business. why are we asking
  for it." The p2p.me questionnaire he pasted was already the `SCREENING` block, field for field (see
  Lessons); what went was the registered-business block ahead of it — legal name, entity type, GSTIN,
  registered address (IN); NIB, NPWP (ID) — from `kyb.ts` + the backend mirror + check-kyb fixtures.
  Kept: PAN/NIK (invariant 30) and `payoutAccount` (check-kyb), both personal. Copy: "About you" /
  "Your details" in the console, "The details check out" in admin, apply's "Business name" → "Name".
  No migration; old keys stay in jsonb and stop rendering. **Open for retro:** whether PAN/NIK stays at
  all (Bridge's call — dropping it retires invariant 30 and the reviewer's identity decision);
  `referredBy`, platform-experience and a pick-list `heardAbout` not added; the `/business` route name
  unchanged; `docs/13:44` still says apply collects a "business name".

- 2026-09-02 · **Pay like any other app** (plan: `~/.claude/plans/on-the-client-app-silly-torvalds.md`):
  the Quote sheet retired, the quote polled live under the amount, one Pay button; the tracker's
  seven-step list replaced by three brand scenes with rotating copy (`PayScene`);
  `payments_unavailable` / `no_merchant` got catalog copy. The "Get quote → payment unavailable"
  report was `escrowLive` false on the local backend (no escrow key / fee destination in
  `apps/backend/.env`; same on stage until the two `STAGE_` vars land). Deliberate cuts: no `/me
  paymentsAvailable` flag (the catalog line covers it), no native motion (the phone cannot pay in
  sponsored mode), two phases not four (the claim flips to Paid). Invariant 55.

- 2026-09-02 · **Trips, circles and bill splitting — shares are requests, the payer's part is derived**
  (plan: `~/.claude/plans/we-are-missing-the-distributed-bumblebee.md` → docs/19; commits `6bf66e0`
  `5d02d2f` `8a6bc66` `a6b6ffb` `3bc662b` + docs, on `stage`, unpushed). Bridge: "we are missing the trip
  or friends creation and easily bill splitting feature… half baked… allow moving transactions… all
  transactions can be seen with their parts… only my part… make sure of receiving things… duplicate
  record removal." Grounded first: NOTHING existed — "Trip balance" was a label on the wallet balance,
  the Payments/Friends filters tested a kind no real row has, `group_id` is LP legs. Shipped: 0026
  (groups, group_members, `transfers.group_id`, `payment_requests.split_of`, the transfer→request unique
  index); `/groups` CRUD-lite gated in SQL; `PATCH /transfers/:id` + `POST /transfers/:id/split`
  (`replaceShares` txn under FOR UPDATE, `check:split` in check:all); the feed's `your_part_usdc` /
  `settlesNote` / payee name; `splitEqual` in cents (check:money); five shared sheets (`groups.tsx`,
  the trip view is a SHEET so both renderers get one implementation); Activity's card becomes
  "Spent this month / Your share", a trips strip, All · Personal · Trips; detail gains Trip › and
  Split ›; mobile twins ported. **Fixed on the way:** TxCard's sign came from the kind (a received
  send printed −); `markRequestPaid` trusted the client's transferId (invariant 58); `POST /requests`
  wrote `to_user_id = null` for an unknown handle; scan-and-pay rows were titled with the pool
  address; the detail page's mock date/reference. **Rejected with evidence:** a `transfer_shares`
  table (re-implements settle/lifecycle/link/notify), tags-as-groups (no roster → pointer 5 fails),
  a server spend aggregate (client holds one page), a row-amount toggle (Bridge: caption + totals).
  **Fleet note:** 3 lenses + 1 planner died on a 429; the orchestrator ran the passes by source.
  **Bridge's hands:** `yarn db:migrate` (0026) on stage; the docs/04 §Status walkthrough with two
  accounts; push on ack. **Open for retro:** the two-phase pay is still non-atomic; `Txn.rupees` is
  INR-only (IDR detail shows dollars); a friend who paid BEFORE the split is a double-ask unless
  ticked "already paid"; Spent sums the loaded page; no netting across a trip.

- 2026-09-02 · **Stake by paying the treasury directly — a chain-checked, admin-attributed claim** (plan:
  `~/.claude/plans/staking-part-is-missing-federated-crab.md` → docs/20; commits `44a45a6` `6fdb1b6`
  `fd38b26` `67d17dd` `a1aa576` `47219f8` `de3469e` `a1097d6` + docs, on `stage`, unpushed). Bridge:
  "staking part is missing… pay to this (our receive address) and submit the transaction hash… admin
  internally marks… ask for their telegram… if duplicate, flag it." Grounded first: `/stake` only signed
  out of the fpay wallet and the console cannot fund it; the verifier required `authority ==
  from_address`; a duplicate signature was a swallowed 409; `attachTransferSignature` could re-point a
  confirmed row (live double credit). Shipped: claims table + two unique indexes (0027), `readStakeDeposit`
  / `treasuryDepositsIn` (batched CEX legs ignored; two into the treasury refused `shared_transaction`),
  `GET/POST /merchants/stake/claims`, admin list/credit/reject (any admin; credit = a pending transfers
  row, the confirmer lands it), the attach guard, base58 on submit, Telegram required (+ reverse mirror
  in check-kyb), the refund address on withdraw/exit + an edit route, LP `/stake` rewritten (poll while
  pending; the in-wallet path kept behind a balance-gated link; the 15-min 404 rerouted into a claim),
  admin "Stake deposits to check" table. Bridge's four calls: keep the in-wallet door; Telegram required
  on About-you; any admin credits; the partner names the refund wallet. **Rejected with evidence:**
  submit-time transfers row + auto-credit (public address, invisible 409, typed amount burns deposits);
  memo-required lane (exchanges cannot memo — hint + stored + shown instead); risk_events-only flag;
  `MAX_STAKE_DEPOSIT_USD` on the credit (guards a typed amount; this one is read); `/me` in the 3 s loop.
  **Critics refuted six of the draft's own remedies** — see docs/20 §Verification record. **Found on the
  way:** a concurrent session took 0026 + docs/19 mid-plan → 0027 / docs/20 (the migrator keys by version;
  a collision is silently skipped). **Bridge's hands:** `yarn db:migrate` (0027) on stage; the stage test
  (docs/20 §How a partner stakes now); push on ack. **Open for retro:** two deposits in one CEX batch
  (`shared_transaction`, by hand via the ledger's unrouted `adjust`); both chain reads at `confirmed`, not
  finalized; the external stake counts against the partner's daily send cap; `listPendingSolanaTransfers`
  unbounded; a dashboard-resident partner sees the stake card until the next `load()`; sender-address
  screening before a stranger stakes (counsel list, docs/15).

- 2026-09-03 · **The partner form, second pass: fewer fixed facts, clearer copy, editable after approval**
  (plan: `~/.claude/plans/staking-part-is-missing-federated-crab.md` Part A → docs/14 §Editing, docs/08,
  docs/11, docs/07; commits `1c1be05` `49a7738` `4bfedee` `7f1b95d`, on `stage`, unpushed). Bridge: "upi
  id… doesn't have to be fixed, users pay from multiple accounts… don't mention p2p, binance… remove the
  error underneath once filled… mention the tier benefits… don't use em dashes at all… PAN should be
  optional (hide if the peer product didn't ask; keep in the database)… allow editing details; important
  edits need a re-check before orders again." Grounded first: nothing reads pan/nik/payoutAccount outside
  the spec, mirror and check; PAN was never screened; the account was never compared with a UTR; the peer
  form (the SCREENING block) never had PAN; `/business` seeded `values` once (blank after a hard
  refresh); the timeline records keys, never values. Shipped: `hidden` + `recheck` flags (mirrored both
  ways), PAN/NIK hidden, account optional, dedicated-account reworded, tier copy in the hint (accurate to
  settled + windowed rates, "down as well as up"), competitor names gone, clear-on-change errors,
  `editMerchantKyb` one statement, admin "re-check: <field>" badge, Edit details on the partner screen,
  105 em dashes replaced + the check (invariant 61). Bridge's four calls: everything incl. admin; keep en
  dashes; hide PAN; re-check on the account fields only. **Critic (8 claims): 2 refuted → corrected**
  (spread order of the carry-forward — hidden keys must WIN; "10 clean payouts" — the gate is settled +
  windowed rates and tiers drop), 6 corrected (array_agg NULL → coalesce; `$2::jsonb`; the trigger fires
  but does not raise; `values` never re-seeded; event titles by event; `envConfig.ts:28`). **Open for
  retro:** an existing partner's stored `'$100 — the minimum'` needs a re-tap; `kybRecheck` shows the
  LATEST edit's keys only; docs/15 §Before a third party inherits "no identifier at all" as a counsel item.

- 2026-09-03 · **The console on routes: Home · Activity · Account, onboarding as a chain, the paid
  moment simplified** (plan: `~/.claude/plans/staking-part-is-missing-federated-crab.md` Part B →
  docs/11; commits `ebddd79` (ui TabBar) `5f610a8` (order screen) + the console commit, on `stage`,
  unpushed). Bridge: "user has to just state that they paid, then submit the UTR… once confirmed paid we
  show the payer it's paid… the dispute window is where the main part happens… not sure of the current
  structure… screens are pretty bad… use routes… minimal, lesser text… a section to see activity."
  Grounded first (lens D): the machine already does that except paid + UTR are ONE call with the UTR
  required — `claimOrderPayout` sets `payout_claimed_at` and the 2-min `expires_at` together, the payer's
  tracker flips to "Paid" on `payoutClaimedAt` and shows the UTR; splitting would show Paid with no
  reference and start the clock early → Bridge kept one step. Lens E: the dashboard was 618 lines, eight
  concerns, six prompts; `/apply` asks name + phone only; Telegram alerts have no UI; `BottomNav` needs
  `usePayStore`. Lens F: `/merchants/orders` already returns completed rows (cap 50, no refunded/failed);
  the 72 h post-completion dispute is unreachable from the payer UI (pre-existing, not in scope).
  Shipped: `@fpay/ui/TabBar` (props-only, out of the barrel so Metro never loads it) + `Icons.Person`
  (both maps); `(tabs)/` layout with NO redirect gate (a transient `/me` failure would otherwise kick a
  working partner off a queue) — Home renders the inline pitch when there is no partner; Activity from
  existing data (`!isLive`, not `completed`-only); Account with six `OneField` routes replacing the
  prompts; the chain on the existing routes (`/business` → `/details`, StepHeader keyed on `kybStatus
  !== 'approved'`, back by entry, `/apply` has no back); the order screen's `claimedLine(order, secs |
  null)`; `check:next` hrefs updated, order assertions untouched; `vercel-ignore` fixture string
  updated. **Critic (8 claims, 12 fixes):** B1 REFUTED twice (redirect gate; `/apply` back trap), B4
  REFUTED (`completed`-only), B2/B5/B6/B7 corrected (exited partners are approved with bond 0; margin
  error copy hardcoded 3.00%; frozen clock → null; icons.native twin). **Open for retro:** Telegram
  alerts still have no UI; Activity omits refunded/failed orders and the bond ledger (a
  `GET /merchants/stake/history` read is the fix if it bites); a dashboard-resident partner sees stale
  state until the 3 s poll; `merchantName` on the payer's `Order` DTO is a latent leak (invariant 21).

- 2026-09-05 · **Stake waiver, root-admin only; Partners / Payout providers tabs; home-screen install
  for the console** (plan: `docs/21-stake-waiver.md`). Bridge: "admin approved a merchant, but they
  still cannot process payments… if approved by admin, please allow this", earlier "a bypasser
  allowance only on strict constraint, merchant side never sees this". Grounded first: no bypass
  existed; the floor sits in EIGHT readers (four SQL gates incl. `lockOrder`, `availableOf`,
  `listWork`, `/me`, the admin status route). Shipped: 0028 `bond_waived_until`; `bondWaived` /
  `bondCap` / `WAIVER_DAYS`; every gate + the lock's flat-floor `case` (+ `$7`); `drawDownBond` clears
  it; owner-active on grant and reinstate; `POST`/`DELETE /admin/merchants/:id/stake-waiver` (root,
  note required, audited); Waive stake / End waiver on approved rows + `waived to` badge; four partner
  strings conditional on `minBondUsdc` 0; `manifest.ts` + `appleWebApp` + 192/512 icons via
  `yarn brand` + `/account/install` row (hidden in standalone); Nav `Partners` / `Payout providers`.
  Rejected: blanket (approval lifts the floor: MIN_BOND dead code, cannot be ended per partner),
  house bond (withdrawable phantom USDC, a ledger lie, rejected by name in queries.ts), admin writes
  `online` (invariant 40). **Skeptics (2× opus + 1× sonnet) broke parts of all four claims:**
  `greatest()` leaked leverage on partial bonds → flat `case`; `listWork` headroom missed → added;
  blocked-owner resurrection via the reinstate mirror → owner-active predicate; two more "$0.00" /
  "by your stake" strings → conditionals. **Open for retro:** reroute (`reassignOrderMerchant`) has
  no capacity predicate, paid exposure still bounded by the lock CAS (pre-existing); the status flip
  on expiry lags up to two stats passes (~160 s) while SQL already excludes; iOS standalone rests on
  the meta, verify on device; whether 30 days is right; `apps/web` install not done; 0028 is Bridge's.

## Telemetry (2026-09-05 stake waiver plan)
- divergence: 0.64 (evidence 0.80, conclusion 0.40) | threshold 0.30 UNCALIBRATED
- models: draft=fable · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: lock-fifth-gate grounded (≤$100 half corrected) · reader-set-complete corrected (listWork) · reinstate-safe corrected (owner-active) · no-partner-tell corrected (2 strings) · drawDownBond-single-caller cross-tier-survived · claim-has-no-bond-gate cross-tier-survived
- fleet: 6 lenses + 1 grounding verifier + 3 skeptics; loop stopped after 1 verify round (cost guard)

- 2026-09-05 · **Admin keeps a track of everything: show the record, capture the two lost values,
  guard the one delete path** (plan: `~/.claude/plans/wondrous-chasing-catmull.md` → docs/22;
  invariant 62). Bridge: "our admin section should also keep track of all transactions, amounts,
  conversions and everything as there can be disputes as well later." Grounded first: the ledger is
  already complete and write-once in the app (`quotes` has no UPDATE; `updateOrder` whitelists seven
  non-money fields; UTR / merchant_id / signature / status all gated one-way; the one ungated amount
  rewrite `reconcileBridgeAmount` has zero callers), and the console throws it away (`AdminOrder`
  already carries rate, fiat, payee, UTR, claimed-at; the order page renders none; transfers listed
  as kind/signature/status only; no cross-user transfers view, no search, no resolved disputes). Two
  capture-now-or-lost values: the mid at strike (dropped at `quoteEngine.ts:48`, not recoverable for
  low-decimal currencies) and the dispute reason (the console never sends the note the route stores).
  **Decided:** four commits, no new system: (1) render the record + every settlement leg + resolver
  / note / bond draw + split legs; (2) `quotes.mid_rate` (0029) + a required note + the seed guard;
  (3) a Transactions page over `transfers` with one exact-match search, audited by shape; (4) SQL
  redaction of the payee on the bulk list, upheld count per partner, docs. **Rejected with evidence:**
  skipping the mid column (the inversion is five-way ambiguous for 500,000 IDR); spread/fee on the
  payer `Quote` (locked invisible fee); evidence upload / CSV / statements page / resolver columns
  (each has a trigger); a text input on `Confirm` (the prompt is the console's pattern). **Verify:**
  grounding 21/25 verified, 4 corrected; skeptics 2 Opus + 1 Sonnet: 4 claims, 2 sub-clauses struck
  (seed.ts is a delete path; a failed-on-chain settlement row is orphaned). **Critique round (4
  lenses, 34 items, 24 folded):** the recommendation never moved; `settle_failed` → `settle_dropped`
  at the orphan site; `q2/o2` joins → columns on `ORDER_SELECT`; 0028 → 0029 (another session holds
  0028); `formatAmount` throws on a 6dp fallback → round at the source; `SEED_WIPE_OK` → no bypass
  + `assertDatabaseTier`; duplicate-column redaction → `orderSelect(payee)`; the send note
  unbounded → capped. One critic claim refuted by grounding (check:copy DOES gate em dashes in
  admin). **Shipped** (four commits on `stage`, unpushed, after the stake-waiver session committed
  its 17 files): `b70e8fc` the record on the order page + every settlement leg reachable + the
  'Best route' mask bug in `toAdminOrder`; `0b92821` 0029 + the `mid_rate` writer + 4dp fallback +
  `note_required` + the seed guard + `reconcileBridgeAmount` deleted; `f823b4a` `/transactions` +
  `searchShape` + `ledger_search` + the send-note cap; the fourth: `orderSelect(payee)` redaction +
  `disputesUpheld90d` + docs 05/06/07/08/09/22. Bridge runs 0029 on stage, then `check:admin` and
  `check:fees` by hand (neither is in `check:all`), then the three open questions.

## Telemetry (2026-09-05 admin ledger plan)
- divergence: 0.74 (evidence 0.78, conclusion 0.68) | threshold 0.30 UNCALIBRATED
- models: draft=fable · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: C1 mid-rate-lost grounded · C2a app-write-once grounded · C2b no-delete-path struck (seed.ts)
  · C3a admin-has-the-fields grounded · C3b dropped-legs-linkable struck (failed-on-chain orphan) ·
  C4 list-redaction-safe grounded
- fleet: 8 lenses + 1 grounding verifier + 3 skeptics + 4 critique = 16 agents

## Telemetry (2026-09-03 partner console plan, Part B)
- divergence: evidence ≈ 0.9 (three disjoint file sets: machine · console · payer/data), conclusion 0.33 | threshold 0.30 UNCALIBRATED
- models: draft=fable · lenses=3× Explore (opus) + 1× Plan critic (opus); skeptic trio NOT RUN (plan
  mode) — every load-bearing claim grounded by re-opening source; version axis unavailable
- claims: flow-matches-except-one-step grounded · completed-orders-in-list grounded · BottomNav-not-
  reusable grounded · check:next-hrefs grounded · B1 REFUTED→corrected · B2 corrected · B3 grounded ·
  B4 REFUTED→corrected · B5 corrected · B6 corrected · B7 corrected · B8 grounded
- grounding: ~25 anchors by the orchestrator, ~110 by lenses + critic; 0 struck for being wrong about
  current code; 2 draft claims refuted, 5 corrected
- fleet: 3 lenses + 1 critic; loop stopped after round 1; `next build` green with 19 routes

## Telemetry (2026-09-03 partner form plan, Part A)
- divergence: 0.72 (evidence 0.75, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=fable · lenses=3× Explore (opus) + 1× Plan critic (opus); skeptic trio NOT RUN (plan
  mode) — every load-bearing claim grounded by re-opening source; version axis unavailable
- claims: C1 corrected · C2 grounded · C3 REFUTED → corrected · C4 corrected · C5 corrected · C6 grounded ·
  C7 REFUTED → corrected · C8 corrected · no-readers grounded · never-screened grounded · em-dash count
  measured (105 prose, comments stripped)
- grounding: ~30 anchors by the orchestrator, ~70 by lenses + critic; 0 struck for being wrong about
  current code; 2 draft remedies refuted, 6 corrected
- fleet: 3 lenses + 1 critic; loop stopped after round 1

## Telemetry (2026-09-02 stake claims plan)
- divergence: 0.75 (evidence 0.80, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=fable · lenses=3× Explore (opus) + 2× Plan critic (opus); skeptic trio NOT RUN (plan mode) —
  every load-bearing claim grounded by re-opening source (orchestrator + critics), which outranks
  cross-tier survival; version axis unavailable
- claims: C1 grounded · C2 grounded · C3 REFUTED → corrected · C4 REFUTED → corrected · C5 corrected ·
  C6 REFUTED → corrected · C7 grounded · C8 corrected · N1 corrected · N2 grounded · N3 REFUTED → corrected
  (one skeptic citation struck by grounding) · N4 REFUTED → ceiling named · N5 corrected
- grounding: ~55 anchors re-opened by the orchestrator, ~100 by the two critics; 0 struck for being wrong
  about current code, 1 skeptic refutation struck, 6 draft remedies refuted and replaced
- fleet: 3 lenses + 2 critics; loop stopped after round 2

## Telemetry (2026-09-02 trips & splitting plan)
- divergence: evidence ≈ 1.0 by construction (three disjoint orchestrator file sets: backend / frontend /
  model+docs; pairwise Jaccard 0) · conclusion n/a (single judge) | threshold 0.30 UNCALIBRATED — FLAG:
  no independent lenses ran, so conclusion diversity is unmeasured
- models: draft=fable · lenses: 2× Explore (opus) completed; 3× Explore + 1× Plan FAILED (HTTP 429 session
  limit, reset 16:40 IST); skeptic trio NOT RUN (plan mode). Version axis unavailable.
- claims: C1 feature-absent grounded (2 explorers + orchestrator) · C2 TxCard-sign grounded · C3
  request-pay-unverified grounded (`queries.ts:651-663` pre-change) · C4 request_id-never-written grounded ·
  C5 escrow_fund-is-the-activity-row grounded (`orderMachine.ts:184`) · C6 refund-is-IN-row grounded
  (`orderMachine.ts:571-578`) · C7 PeopleSearch-not-exported grounded · C8 payee-name-one-join-away grounded ·
  C9 client-holds-one-page grounded (`api.ts:137`)
- grounding: 31 anchors re-opened by the orchestrator, 0 struck, 2 corrected
- fleet: 2 of 6 lenses completed; loop stopped after round 1 (Bridge's four answers all defaults)

## Telemetry (2026-09-01 sessions/boot plan)
- divergence: 0.72 (evidence 0.76, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=fable · lenses=3× Explore (opus) + 2× Plan critic (opus); skeptic trio NOT RUN (plan mode) —
  every load-bearing claim grounded by re-opening source (orchestrator + critics), which outranks cross-tier
  survival; version axis unavailable
- claims: C1 LP-wallet-gate grounded (+SDK `useWallets.ready` gates on the wallet proxy) · C2 no_account-logout
  grounded, v1 fix REFUTED → corrected · C3 5s-fallback grounded, v1 design (`sessionFound`) REPLACED by the chain
  split; round 2 on the split: 5 survived, V3/V5/V7/V9 REFUTED → corrected · C4 api-85%-shipped grounded ·
  C5 admin-switch-exists grounded · B2 admin-DELETE-400 grounded (fastify source) · D2 corrected · D3 REFUTED → cut ·
  L1 "backend 401 destroys the session" STRUCK
- grounding: 41 anchors re-opened by the orchestrator, ~60 by the two critics; 0 struck for being wrong about
  current code, 7 draft remedies struck or corrected
- fleet: 3 lenses + 2 critics; loop stopped after round 2

## Telemetry (2026-09-01 handle+email plan)
- divergence: 0.78 (evidence 0.86, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=fable · lenses=3× Explore + 1× Plan critic (plan mode: skeptic trio NOT RUN; every load-bearing
  claim grounded by re-opening source, which outranks cross-tier survival; version axis unavailable)
- claims: C1 adoption-ignores-handle grounded-after-correction · C2 email-raw-end-to-end grounded · C3
  admin-columns-not-bug grounded · C4 handle-canonical-on-every-write grounded · C4b draftHandle-on-admin
  REFUTED · C5 probe-on-mount grounded · C6 denylist-raw-write grounded · C7 privy-casing-undocumented grounded
- grounding: 37 anchors re-opened by the orchestrator + critic, 0 struck, 2 corrected
- fleet: 3 lenses + 1 critic; loop stopped after round 1

## Telemetry (2026-09-01 LP self-signup plan)
- divergence: 0.77 (evidence 0.83, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=fable · lenses=3× Explore (opus) + 1× Plan critic (opus); skeptic trio NOT RUN (plan mode) —
  every load-bearing claim grounded by re-opening source, which outranks cross-tier survival; version axis
  unavailable
- claims: C1 lockout grounded (+strengthened: four gate keys differ) · C2 no-new-capability grounded
  (corrected: CORS exists, forgeable) · C3 house-codes grounded (+waitlist burn) · C4 treasury-drift grounded,
  remedy REFUTED → in-txn re-point · C5 console-self-contained grounded (A4 demoted) · N1 keys-differ ·
  N2 waitlist-burn · N3 refund-live-wallet · N5 trigger-scope — all grounded
- grounding: 21 anchors re-opened by the orchestrator, 0 struck, 2 corrected
- fleet: 3 lenses + 1 critic; loop stopped after round 1

## Telemetry (2026-08-31 Privy-one-app + LP-gate plan)
- divergence: 0.77 (evidence 0.83, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=fable · lenses=3× Explore + 1× Plan critique (plan mode: skeptic panel NOT RUN; every
  load-bearing claim grounded by re-opening source, which outranks cross-tier survival; version axis unavailable)
- claims: C1 grounded · C2 grounded · C3 grounded-after-correction · C4 refuted-then-fixed · 9 struck
  (pre-push-gap, header-in-block, email-collision, mobile-loginMethods, subpath-import, lp-readme,
  backend-first-or-duplicates, check-env-comment, next-prefix-guard)
- grounding: 14 anchors after fan-out (0 struck) · 7 after critique (0 struck) · pairwise Jaccard 0.08/0.18/0.26
- fleet: 3 lenses + 1 critique

## Telemetry (2026-08-31 KYC-still-asked / deploy-gap plan)
- divergence: 0.80 (evidence 0.89, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=fable · critic=1× Plan agent · skeptics NOT RUN (plan mode: Explore/Plan only) — claims grounded
  by source, live probe (`/health` on both tiers) and vendor docs (Vercel system env vars, 2026-07-15)
- claims: C1 unpushed grounded · C2 isMainnet-503 grounded · C3 client-verify-gate grounded · C4 escrowLive-prereq
  grounded · C5 KYC_PROVIDER-unset grounded · C6 migration-in-container grounded (corrected) · C7 keypairs-unignored
  superseded (`6ae48fd`) · C8 prod-backend-absent STRUCK · C9 persona-live-by-fallback unresolved, fix-invariant ·
  C10 vercel-gate-tip-only grounded · C11 no_merchant-precondition grounded
- fleet: 3 lenses + 1 critic; loop stopped after round 1 (material change; remaining unknowns are dashboard state)

## Telemetry (2026-08-31 escrow audit + pool plan)
- divergence: 0.62 (evidence 0.85, conclusion 0.27) | threshold 0.30 UNCALIBRATED — conclusions converged on the program before Bridge chose otherwise; evidence sets did not
- models: draft=opus · skeptics round 1 = 2x-opus · round 2 = 1x-opus + 1x-sonnet (cross-tier; version axis unavailable)
- claims: V1 grounded · V2 grounded-after-correction · V3 grounded-after-correction · V4 refuted · B1 grounded-after-fix · B2 grounded-after-fix · B3 grounded-after-fix · B4 grounded-after-correction
- grounding: round 1 16/20 verified, 4 corrected, 0 struck · round 2 7/12 verified, 5 corrected, 0 struck
- fleet: 6 lenses + 2 grounding verifiers + 4 skeptics; loop stopped at round 2

## Telemetry (2026-08-30 pilot plan)
- divergence: round 1 0.88 (evidence 0.94, conclusion 0.80) · round 2 0.77 (evidence 0.88, conclusion 0.60) | threshold 0.30 UNCALIBRATED
- models: draft=opus · skeptics=2x-opus+1x-sonnet per round (cross-tier; version axis unavailable)
- claims: C1 grounded · C2 cross-tier-survived (2-1) · C3 grounded · C4 grounded · N1 grounded-after-fix · N2 grounded-after-correction (one refutation itself struck) · N3 grounded-after-fix · N4 grounded-after-fix
- grounding: round 1 17/22 verified, 5 corrected, 1 strike withdrawn · round 2 18/23 verified, 5 corrected, 0 struck
- fleet: 6 + 6 lenses, 2 grounding verifiers, 6 skeptics; loop stopped at 2 rounds

## Telemetry (2026-08-29 audit pass)
- divergence: 0.69 (evidence 0.70, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=opus · skeptic panel NOT RUN (plan mode restricts subagents to Explore/Plan) — the
  load-bearing claims were grounded by re-reading source instead, which outranks cross-tier survival
- claims: tier-grant-buys-nothing · sim-on-stage · privy-shim-on-stage · treasury-unfiltered ·
  setKycSession-erases-provenance · cashout-503-on-mainnet — 6 grounded, 0 struck
- fleet: 3 lenses (attack / correctness / rules-cartography), differential file sets

## Telemetry (2026-08-29 manual-onboarding plan)
- divergence: 0.75 (evidence 0.81, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=opus · skeptic panel NOT RUN (plan mode restricts subagents to Explore/Plan) — every
  load-bearing claim grounded instead by re-reading source, which outranks cross-tier survival
- claims: boot-throws · apply-tier-gate · kyb_fields-jsonb · setKycApproved-greatest ·
  sim-live-on-stage · admin-hides-evidence-after-decide — all 6 grounded, 0 struck
- fleet: 3 explorer lenses (differential file sets), orchestrator judged

## Telemetry (2026-08-24 routing plan)
- divergence: 0.71 (evidence 0.85, conclusion 0.50) | threshold 0.30 UNCALIBRATED
- models: draft=fable · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: C1 grounded · C2 refuted-impact · C3 refuted · C4 grounded · grounding sweep 22/22 (0 struck)
- fleet: 8 lenses + 1 grounding verifier + 3 skeptics
