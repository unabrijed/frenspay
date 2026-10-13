# Monad UPI simulation beta

Decision: 13 October 2026. Target Metropolis, Consumer Products & Payments. This is an invite-only web beta using the current Frenspay visual language. Real UPI settlement remains deferred. No hackathon submission has been sent by this implementation.

## Product contract

1. Redeem an invitation and sign in with Dynamic email authentication. The backend verifies membership and binds the verified identity to its verified embedded EVM wallet.
2. Add native USDC to that wallet on **Monad mainnet, chain 143**. The supported token is `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`. Mainnet funds are real; testnet tokens do not qualify. Funding supports a connected external wallet, address/QR transfer and an exchange withdrawal that supports Monad. Card/bank on-ramps are not configured, and no cross-chain bridge is offered.
3. Refresh the finalized balance. Lifetime credit entitlement equals highest verified USDC balance multiplied by highest attained profile multiplier. Grant only the positive increase over credits already granted. Email gives 1×; name and country 2×; verified phone 5×; linked X account 10×. There is no free allocation or daily reset.
4. Scan or paste an Indian UPI QR, review its payee and INR amount, and confirm a simulation. Fixed QR amounts cannot be changed. The server quotes INR into test credits, expires the quote after 90 seconds, and atomically debits credits once.
5. Receive points and in-app badges. Every result says it is simulated: **no merchant is paid**. A background worker attempts a zero-value, salted receipt commitment on Monad testnet, chain 10143. Receipt failure never repeats the credit debit.
6. Withdraw real USDC independently. Credits already granted survive withdrawal; depositing the same balance again grants nothing. Export/recovery stays available when simulations are paused.

Example: a verified 10 USDC peak at 2× grants 20 credits. Spending 4 leaves 16. Withdrawing and redepositing 10 grants zero. Reaching 5× raises total entitlement to 50 and adds 30, leaving 46. This is a promotional allowance, not collateral or a redeemable balance. Points and badges carry no promise of money, token allocation or future drops.

Badge criteria: first simulation, three distinct payees, three active days in Asia/Kolkata. QR payee/category/city fields are unverified user-supplied metadata. Missing geography stays unknown. The app requests no GPS permission or city input. Simulations are not proof of a merchant purchase, identity or physical visit. Funding can be recycled between different users; invitations and analytics exclusions reduce abuse but do not prove unique economic activity.

## Code and data

| Area | Location |
| --- | --- |
| Web journey | `apps/web/src/components/campaign/CampaignApp.tsx` |
| Separate client state and API | `packages/app/src/campaignStore.ts`, `services/campaignApi.ts` |
| Contracts and strict URI/EMV parser | `packages/shared/src/campaign.ts`, `upi.ts` |
| Server routes, verified ledger, withdrawals, receipt worker | `apps/backend/src/routes/campaign.ts`, `services/campaign/` |
| Isolated tables | `apps/backend/src/db/migrations/0034_monad_upi_campaign.sql` |
| Operator dashboard | `apps/admin/src/app/campaign/page.tsx` |

The prior Singapore `prelaunch_*` tables remain separate and are never imported as free credits. `/legacy-wallet` retains historical recovery. Simulation mode does not mount the Solana payment bridge or legacy payment sheets. Server policy rejects new orders, transfers, merchant signing actions and cross-chain intents, including calls from stale clients. Existing submission/reconciliation paths remain for recovery.

Campaign spends use account row locks, unique idempotency keys and a durable receipt queue. The browser saves the spend key before sending; an ambiguous response is retried using that same key. Withdrawal intents are persisted before wallet signing, allow only one pending intent per account, and verify chain, token, sender, recipient and amount. A matching observed transaction hash is persisted before finality. If submission is ambiguous before the server observes the transaction, recover its hash from wallet activity; never sign again blindly. Clearing an unsigned request requires explicit acknowledgment and does not cancel a blockchain transaction.

Admin reporting includes invitations, funded accounts, repeat usage, payees, categories, cities, receipts and errors. Admins can mark accounts as test data or pause simulations with an audit entry. Test accounts are excluded from campaign reporting. Error counters are process-local diagnostics and reset on restart; they are not durable incident metrics. Unknown account-abstraction receipt envelopes go to review, not success.

## Configuration and release gates

Backend production uses bare names; stage uses `STAGE_`; local uses `LOCAL_` with stage fallback. Use isolated fixtures for tests, never the inherited stage database.

| Setting | Required action |
| --- | --- |
| `CUSTOMER_PAYMENT_MODE` | Set `simulation` on the backend; default is `live` for compatibility |
| `NEXT_PUBLIC_CUSTOMER_PAYMENT_MODE` | Set `simulation` for the production customer web build; local/stage use the corresponding prefixed frontend name |
| `CAMPAIGN_FUNDING_ENABLED` | Keep `false` until verified deposit/withdrawal smoke test; enables new balance-derived grants and deposit UI |
| `CAMPAIGN_SPENDING_ENABLED` | Keep `false` until acceptance checks; enables new sessions/simulations |
| `MONAD_RPC_URL` | Mainnet RPC supporting finalized block and native token reads |
| `MONAD_TESTNET_RPC_URL` | Testnet RPC for receipt confirmations |
| `DYNAMIC_API_TOKEN`, `DYNAMIC_RECEIPT_WALLET_JSON`, `PRELAUNCH_RECEIPT_ADDRESS` | Platform-owned Dynamic signing bundle and matching address; server-only secrets |
| Gas | Users need mainnet MON for real withdrawals; platform receipt wallet needs free testnet MON |
| Phone verification | Configure a supported production OTP provider before advertising the phone tier; console OTP is not production verification |

Keep the old campaign retired and real-payment/card features disabled for this release. Backend capabilities and frontend mode must agree; the campaign fails closed on disagreement. Feature flags do not prevent unsolicited blockchain deposits to an already-known address.

Release sequence:

1. Deploy migration/backend and admin with both campaign flags false. Set backend simulation mode, then deploy a customer web build with matching mode. Confirm unauthenticated and non-invited requests are rejected and new real-payment intents return `simulation_only`.
2. Provision RPCs and the Dynamic receipt wallet. Verify the configured chains, exact token, receipt wallet address and supported account-abstraction envelope. Do not infer readiness from credentials being present.
3. Use an explicitly invited operator account marked as test data. Enable the campaign during a controlled acceptance window for that cohort. Verify a small real USDC deposit, confirmed withdrawal, wallet export, one simulation, receipt attestation and reload recovery. This requires an operator-owned wallet and actual funds; automated fixtures cannot establish it.
4. Check admin exclusions and pause behavior. If sponsorship, receipt recovery or withdrawal fails, turn funding and spending off while retaining wallet recovery. Resolve the failure before admitting users.
5. Admit the limited cohort, monitor receipt review jobs/errors, and record the deployed commit, configuration and smoke-test evidence. Native mobile and real settlement are out of scope.

Production observation on 13 October: Railway `fpay` production lacks both campaign flags, payment mode, Monad RPCs and the receipt wallet configuration. Privy credentials exist. Phone OTP configuration is absent. No production migration, activation, real-money smoke test or deployment was performed as part of the local implementation.

## Verification and submission

Local implementation validation on 13 October: all nine workspace TypeScript checks, the existing `check:all` suite, campaign PostgreSQL integration tests, campaign browser tests, and backend/customer-web/admin production builds passed. Receipt verification tests include successful and failed sponsored operations, incorrect commitments and incorrect entry points. These results are not production acceptance evidence.

From `monorepo`, use the pinned Node 24 and Yarn 1.22.22:

```sh
yarn typecheck
yarn check:all
yarn check:campaign
yarn check:campaign:postgres
yarn check:campaign:browser
yarn workspace @fpay/backend build
NEXT_PUBLIC_CUSTOMER_PAYMENT_MODE=simulation yarn workspace @fpay/web build
yarn workspace @fpay/admin build
```

Campaign tests isolate the database and mock external services. The PostgreSQL variant tests real locking and concurrent spends. Browser tests mount the actual campaign component with mocked identity/API: deposit gating, lost-response recovery, storage failure, withdrawal recovery and no payment-signing call during simulations. They do not prove production signing or RPC availability. Local validation used available Node 25.9.0; release runtime remains pinned to Node 24.

Demo script: invited email login → real USDC balance and test allowance → scan ordinary UPI QR → explicit simulation confirmation → points/badge and testnet attestation → real USDC still present → withdrawal/recovery → admin usage with operator accounts excluded. Never show a simulated success as proof a shop was paid.

Submission framing: “Frenspay lets invited users rehearse a USDC-funded UPI-style payment experience on Monad, earning points while testing onboarding, QR parsing and wallet recovery. Settlement is simulated; live UPI requires a future provider integration.” Show only implemented and verified behavior. Identify pre-existing components separately from work completed during the event. Confirm deadline and eligibility in the registered portal before submitting; no exact cutoff is asserted here.

References: [Metropolis](https://monad.xyz/metropolis), [Circle token addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), [Dynamic wallet SDK](https://www.dynamic.xyz/docs/node/quickstart), [UPI request fields](https://developers.google.com/pay/india/api/web/create-payment-method).


## Dynamic migration (13 October)

Privy SDK dependencies and active integrations are removed from web, admin, LP,
mobile and backend. Web/admin/LP use Dynamic React 5.10.0. Expo uses the current
headless JavaScript SDK 1.37.0 and needs a new native development/release build.
The native app retains its Solana product; it is not the Monad simulation beta.
Solana embedded wallets must be enabled before using native/LP signing.

The public Dynamic environment is `4fc2a73c-1662-45eb-9257-8baa567066a6`.
Client environment overrides remain available. Customer web defaults to the
simulation experience. Backend mode and funding/spending flags remain separately
controlled. Deployed tiers never accept the local development identity header.

Migration 0035 preserves campaign subjects under `auth_subject`. Migration 0036
adds durable Dynamic identity bindings for existing user profiles and signed
receipt bytes. Verified email can bind an existing operator/native profile once;
this preserves its role, history and wallet addresses. A different wallet at
account setup returns `wallet_migration_required`. Campaign email collisions
remain blocked to prevent resetting grants. Old wallet funds and private keys
are not migrated. Recovery routes now direct users to support; historical SQL
columns retain their original names for compatibility. Old credentials may be
retained for operational rollback, but this binary never uses them.

JWT verification checks signature, issuer, expiry, issuance time, scope and
optional audience. Email and embedded EVM/Solana ownership come from the
provider's authenticated profile. External funding wallets cannot become the
campaign's spending wallet.

The platform receipt signer uses Dynamic Node SDK 1.1.36. It signs zero-value
commitments only on Monad testnet 10143. A database advisory lock coordinates
nonces across workers and both ledgers. Signed bytes and hash are saved before
broadcast; retries submit identical bytes. Ambiguous jobs from the old signer
are quarantined for review. Funding this wallet requires only free testnet MON.
The provisioned address is `0x4Fc9ddad150F5604d3841478E5eC6a37254355dA`.

Railway production now has the Dynamic token, wallet bundle, simulation mode,
funding/spending flags and mainnet/testnet RPCs staged without automatic deploys.
Deployment and authenticated acceptance results must be recorded separately.
The receipt wallet had zero testnet MON at the configuration check.

Users can fund with a connected wallet or a native-USDC deposit address/QR on
Monad 143. No bank/card provider is configured. Real withdrawals require mainnet
MON; no unsupported sponsorship is silently replaced with a user-paid attempt.
Wallet export stays inside Dynamic's secure UI. Native exports use its WebView
component, which does not expose the key to the host JavaScript layer.

Invite and verification entry display individual boxes while preserving paste,
autofill and text editing. A pasted FREN-prefixed invitation is normalized.

Validation: signed-token and identity checks; PostgreSQL credit/concurrent-debit
checks; invite/access and existing-identity binding checks; receipt durable-retry
and nonce tests; browser simulation and code-entry tests. A real authenticated
production login, deposit and withdrawal still need acceptance testing.

References:
- https://www.dynamic.xyz/docs/auth/tokens
- https://www.dynamic.xyz/docs/node/quickstart
- https://www.dynamic.xyz/docs/platform/dashboard/api-token-permissions
- https://www.dynamic.xyz/docs/javascript/react-native/expo

### Dynamic release checks (2026-10-13)

All workspace typechecks and `check:all` passed. Web, admin and LP production builds passed.
Isolated checks cover verified Dynamic identities and Solana wallet binding, existing-profile adoption without wallet replacement, invitation redemption, simulated spending, receipt retries/nonces/mainnet rejection, withdrawals, and code-box typing/paste.
The invitation browser fixture now mounts the Dynamic gate; SDK email delivery and private-key export still require an authenticated production smoke test. Removed browser assertions for the retired Privy card-checkout widget; shared payment/recovery checks remain. Native changes require a new device build.

Receipt wallet testnet gas is separate from user USDC spending caps. With zero testnet MON, simulations and points remain usable but onchain receipt publication cannot complete. No real funds should be sent to the platform receipt wallet.

### Production promotion (2026-10-13)

Release `8fa6a18` was promoted in `f97efb8` to both `stage` and `sacred`. Railway production deployment `79dde42d-3b01-4e23-85ff-2fa5b7b3a5c5` succeeded and applied migrations 0034–0036; `/health` returns 200 and the campaign routes require authentication. Vercel completed customer, admin, LP and landing deployments. The live customer page opens Dynamic email sign-in; browser inspection identified missing Dynamic asset origins in CSP, corrected in the following frontend patch.

Dynamic public settings were re-read after the dashboard update: Solana enabled, SOL and EVM embedded wallets enabled, automatic wallet creation enabled. SDK email delivery, authenticated funding/withdrawal/export, native device behavior and a confirmed testnet receipt still need acceptance testing.
