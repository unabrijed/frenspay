> Current direction (2026-10-14): flat 10× simulation credits backed by verified mainnet USDC balance. Simulated payments and points stay offchain. Both receipt workers are disabled at server startup. No free/testnet MON is required. Earlier receipt-worker rollout notes below are historical and superseded.

# Monad UPI simulation beta

Decision: 13 October 2026. Target Metropolis, Consumer Products & Payments. This is an invite-only web beta using the current Frenspay visual language. Real UPI settlement remains deferred. No hackathon submission has been sent by this implementation.

## Local testing and stage admin access

Run these commands from `monorepo`:

- `yarn dev:web` runs the customer app and local API in development mode. The API's dev command explicitly selects `NODE_ENV=development`, so a production value in `.env` cannot silently switch the local API to production settings.
- `yarn preview:web:stage` builds and serves the customer app with the stage frontend configuration.
- `yarn preview:web:prod` builds and serves the customer app with the production frontend configuration, while deliberately using **stage API data and Dynamic sandbox authentication**. This exercises an optimized build, production CSP, and production frontend flags without selecting live accounts.

Stop the customer dev server on port 3000 before starting either preview, then open `http://localhost:3000`. Both previews rebuild before serving and use `.next-preview`, separate from the normal `.next` output. Add `--build-only` to validate a build without starting the server. No local backend workers or migrations are started by either preview.

The local Next server forwards `/__preview_api/*` to the fixed stage API host; the normal deployed app has no preview proxy. Allow `http://localhost:3000` in the **sandbox** Dynamic environment (`4fc2a73c-1662-45eb-9257-8baa567066a6`). No live Dynamic CORS change is needed. Stage still uses mainnet wallets: the preview is not an isolated money simulator. It does not reproduce production account data, live Dynamic settings, or differences in deployed backend versions.

`STAGE_ADMIN_EMAILS` already includes `unabrijed@gmail.com` locally and on Railway stage. The stage account is active and the API's `effectiveRole` check returns `admin`; this email allowlist overrides its stored `user` role. Sign in to the local admin console with the sandbox identity and select the stage target to manage access.

## Product contract

1. Redeem an invitation and sign in with Dynamic email authentication. The backend verifies membership and binds the verified identity to its verified embedded EVM wallet.
2. Add native USDC to that wallet on **Monad mainnet, chain 143**. The supported token is `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`. Mainnet funds are real; testnet tokens do not qualify. Funding supports a connected external wallet, address/QR transfer and an exchange withdrawal that supports Monad. Card/bank on-ramps are not configured, and no cross-chain bridge is offered.
3. Refresh the finalized balance. Lifetime simulation-credit entitlement equals 10× the highest verified USDC balance. Grant only the positive increase over credits already granted. Profile completion does not change the multiplier. There is no free allocation or daily reset.
4. Scan or paste an Indian UPI QR, review its payee and INR amount, and confirm a simulation. Fixed QR amounts cannot be changed. The server quotes INR into test credits, expires the quote after 90 seconds, and atomically debits credits once.
5. Receive points and in-app badges. Every result says it is simulated: **no merchant is paid**. Simulation results and points are stored in the application database. No payment or receipt transaction is signed or broadcast; no testnet MON is needed.
6. Withdraw real USDC independently. Credits already granted survive withdrawal; depositing the same balance again grants nothing. Export/recovery stays available when simulations are paused.

Example: 10 real USDC unlocks 100 simulation credits. Spending 4 leaves 96; real USDC stays 10. Withdrawing and redepositing the same 10 grants nothing. A new verified peak of 12 USDC adds 20 credits. Credits and points are not withdrawable money or real USDC.

Badge criteria: first simulation, three distinct payees, three active days in Asia/Kolkata. QR payee/category/city fields are unverified user-supplied metadata. Missing geography stays unknown. The app requests no GPS permission or city input. Simulations are not proof of a merchant purchase, identity or physical visit. Funding can be recycled between different users; invitations and analytics exclusions reduce abuse but do not prove unique economic activity.

## Code and data

| Area | Location |
| --- | --- |
| Web journey | `apps/web/src/components/campaign/CampaignApp.tsx` |
| Separate client state and API | `packages/app/src/campaignStore.ts`, `services/campaignApi.ts` |
| Contracts and strict URI/EMV parser | `packages/shared/src/campaign.ts`, `upi.ts` |
| Server routes, verified ledger, withdrawals | `apps/backend/src/routes/campaign.ts`, `services/campaign/` |
| Isolated tables | `apps/backend/src/db/migrations/0034_monad_upi_campaign.sql` |
| Operator dashboard | `apps/admin/src/app/campaign/page.tsx` |

The prior Singapore `prelaunch_*` tables remain separate and are never imported as free credits. `/legacy-wallet` retains historical recovery. Simulation mode does not mount the Solana payment bridge or legacy payment sheets. Server policy rejects new orders, transfers, merchant signing actions and cross-chain intents, including calls from stale clients. Existing submission/reconciliation paths remain for recovery.

Campaign spends use account row locks, unique idempotency keys and database simulation records. The browser saves the spend key before sending; an ambiguous response is retried using that same key. Withdrawal intents are persisted before wallet signing, allow only one pending intent per account, and verify chain, token, sender, recipient and amount. A matching observed transaction hash is persisted before finality. If submission is ambiguous before the server observes the transaction, recover its hash from wallet activity; never sign again blindly. Clearing an unsigned request requires explicit acknowledgment and does not cancel a blockchain transaction.

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
| Testnet RPC / receipt signer | Not required; receipt workers are no longer started |
| `DYNAMIC_API_TOKEN`, `DYNAMIC_RECEIPT_WALLET_JSON`, `PRELAUNCH_RECEIPT_ADDRESS` | Historical receipt-signer credentials, unused by the simulation flow; not required |
| Gas | Mainnet transfers/withdrawals have normal network fees; simulations need no MON |
| Phone verification | Configure a supported production OTP provider before advertising phone verification; console OTP is not production verification |

Keep the old campaign retired and real-payment/card features disabled for this release. Backend capabilities and frontend mode must agree; the campaign fails closed on disagreement. Feature flags do not prevent unsolicited blockchain deposits to an already-known address.

Release sequence:

1. Deploy migration/backend and admin with both campaign flags false. Set backend simulation mode, then deploy a customer web build with matching mode. Confirm unauthenticated and non-invited requests are rejected and new real-payment intents return `simulation_only`.
2. Configure the Monad mainnet RPC and Dynamic embedded wallet. Verify chain 143 and the exact native-USDC token. No testnet receipt wallet is required.
3. Use an explicitly invited operator account marked as test data. Enable the campaign during a controlled acceptance window for that cohort. Verify a small real USDC deposit, confirmed withdrawal, wallet export, one simulation, offchain simulation record and reload recovery. This requires an operator-owned wallet and actual funds; automated fixtures cannot establish it.
4. Check admin exclusions and pause behavior. If funding or withdrawal fails, turn funding and spending off while retaining wallet recovery. Resolve the failure before admitting users.
5. Admit the limited cohort, monitor simulation and withdrawal errors, and record the deployed commit, configuration and smoke-test evidence. Native mobile and real settlement are out of scope.

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

Demo script: invited email login → real USDC balance and test allowance → scan ordinary UPI QR → explicit simulation confirmation → points/badge and database simulation record → real USDC still present → withdrawal/recovery → admin usage with operator accounts excluded. Never show a simulated success as proof a shop was paid.

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

## Permanent practice-payment classification

Campaign activity is labelled **Prelaunch · Practice** in the UI; receipts state **No money sent · Not a real expense**. This label is independent of any historical onchain receipt status.

Migration `0038_simulation_classification.sql` classifies both existing and new rows in `campaign_spends` and retired `prelaunch_spends` with `transaction_kind = 'simulation'` and `counts_toward_expenses = false`. NOT NULL and CHECK constraints prevent either ledger being reclassified as real payments. History and spend API responses carry `transactionKind` and `countsTowardExpenses` too.

At live launch, retain this history as practice activity. Do not import these records into `transfers`, `expense_payments`, real spending totals, or real-money balance calculations. Real expense queries already read only the transfer ledger, and expense payments have a foreign key to `transfers`. Exports or future combined activity views must preserve the classification and exclude simulations from real values. Real USDC deposits and withdrawals remain real transfers; this migration does not relabel them. Deploy the migration before the updated API.
