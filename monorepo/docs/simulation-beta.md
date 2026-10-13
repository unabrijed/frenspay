# Monad UPI simulation beta

Decision: 13 October 2026. Target Metropolis, Consumer Products & Payments. This is an invite-only web beta using the current Frenspay visual language. Real UPI settlement remains deferred. No hackathon submission has been sent by this implementation.

## Product contract

1. Redeem an invitation and sign in with the selected provider's email authentication (Dynamic for the new beta; Privy retained for recovery). The backend verifies membership and binds the verified identity to its verified embedded EVM wallet.
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

Backend production uses bare names; stage uses `STAGE_`; local uses `LOCAL_` with stage fallback. Privy credentials remain unprefixed. Use isolated fixtures for tests, never the inherited stage database.

| Setting | Required action |
| --- | --- |
| `CUSTOMER_PAYMENT_MODE` | Set `simulation` on the backend; default is `live` for compatibility |
| `NEXT_PUBLIC_CUSTOMER_PAYMENT_MODE` | Set `simulation` for the production customer web build; local/stage use the corresponding prefixed frontend name |
| `CAMPAIGN_FUNDING_ENABLED` | Keep `false` until verified deposit/withdrawal smoke test; enables new balance-derived grants and deposit UI |
| `CAMPAIGN_SPENDING_ENABLED` | Keep `false` until acceptance checks; enables new sessions/simulations |
| `MONAD_RPC_URL` | Mainnet RPC supporting finalized block and native token reads |
| `MONAD_TESTNET_RPC_URL` | Testnet RPC for receipt confirmations |
| `PRELAUNCH_RECEIPT_WALLET_ID`, `PRELAUNCH_RECEIPT_ADDRESS` | Matching platform-owned Privy receipt wallet; reused configuration, not the old campaign ledger |
| Privy app sponsorship | Verify app-paid Monad mainnet withdrawals and testnet receipt transactions with the actual app |
| Phone verification | Configure a supported production OTP provider before advertising the phone tier; console OTP is not production verification |

Keep the old campaign retired and real-payment/card features disabled for this release. Backend capabilities and frontend mode must agree; the campaign fails closed on disagreement. Feature flags do not prevent unsolicited blockchain deposits to an already-known address.

Release sequence:

1. Deploy migration/backend and admin with both campaign flags false. Set backend simulation mode, then deploy a customer web build with matching mode. Confirm unauthenticated and non-invited requests are rejected and new real-payment intents return `simulation_only`.
2. Provision RPCs, the receipt wallet and Privy sponsorship. Verify the configured chains, exact token, receipt wallet address and supported account-abstraction envelope. Do not infer readiness from credentials being present.
3. Use an explicitly invited operator account marked as test data. Enable the campaign during a controlled acceptance window for that cohort. Verify a small real USDC deposit, confirmed withdrawal, wallet export, one simulation, receipt attestation and reload recovery. This requires an operator-owned wallet and actual funds; automated fixtures cannot establish it.
4. Check admin exclusions and pause behavior. If sponsorship, receipt recovery or withdrawal fails, turn funding and spending off while retaining wallet recovery. Resolve the failure before admitting users.
5. Admit the limited cohort, monitor receipt review jobs/errors, and record the deployed commit, configuration and smoke-test evidence. Native mobile and real settlement are out of scope.

Production observation on 13 October: Railway `fpay` production lacks both campaign flags, payment mode, Monad RPCs and the receipt wallet configuration. Privy credentials exist. Phone OTP configuration is absent. No production migration, activation, real-money smoke test or deployment was performed as part of the local implementation.

## Verification and submission

Local implementation validation on 13 October: all nine workspace TypeScript checks, the existing `check:all` suite, campaign PostgreSQL integration tests, campaign browser tests, and backend/customer-web/admin production builds passed. Receipt verification tests include successful and failed sponsored operations, incorrect commitments and incorrect entry points. Frontend builds retain existing Privy dependency dynamic-import warnings. These results are not production acceptance evidence.

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

Campaign tests isolate the database and mock external services. The PostgreSQL variant tests real locking and concurrent spends. Browser tests mount the actual campaign component with mocked identity/API: deposit gating, lost-response recovery, storage failure, withdrawal recovery and no payment-signing call during simulations. They do not prove production Privy sponsorship or RPC availability. Local validation used available Node 25.9.0; release runtime remains pinned to Node 24.

Demo script: invited email login → real USDC balance and test allowance → scan ordinary UPI QR → explicit simulation confirmation → points/badge and testnet attestation → real USDC still present → withdrawal/recovery → admin usage with operator accounts excluded. Never show a simulated success as proof a shop was paid.

Submission framing: “Frenspay lets invited users rehearse a USDC-funded UPI-style payment experience on Monad, earning points while testing onboarding, QR parsing and wallet recovery. Settlement is simulated; live UPI requires a future provider integration.” Show only implemented and verified behavior. Identify pre-existing components separately from work completed during the event. Confirm deadline and eligibility in the registered portal before submitting; no exact cutoff is asserted here.

References: [Metropolis](https://monad.xyz/metropolis), [Circle token addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), [Privy sponsorship](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview), [UPI request fields](https://developers.google.com/pay/india/api/web/create-payment-method).


## Dynamic provider switch (13 October)

The new beta uses Dynamic React SDK 5.10.0 with its built-in authentication,
step-up and recovery UI. Privy dependencies and credentials remain intact.
A provider adapter keeps the simulation ledger independent of either wallet SDK.
Use `/wallet-recovery` for existing Privy campaign wallets and `/legacy-wallet`
for older Singapore wallets. A hard navigation between providers resets the SDK
and API session. New Dynamic wallets have new addresses; no funds or keys are
silently moved, and matching email addresses are never automatically merged.
An existing campaign email collision is blocked and requires a deliberate
migration; it cannot reset credit history. Reverting the provider selects the
original Privy account; it does not move Dynamic wallet funds.

Migration 0035 renames the campaign identity column to `auth_subject`. Existing
Privy DIDs remain unchanged. Dynamic subjects include the environment and user
ID. Authentication verifies RS256, issuer, expiry, issuance time, complete auth
scope and optional audience, then fetches the authenticated profile from
Dynamic. Email and embedded wallet ownership come only from verified provider
credentials. External funding wallets never become the campaign spending wallet.
The browser sends the SDK's access token, not its legacy ID token.

Production Railway now has `DYNAMIC_ENVIRONMENT_ID` and
`CAMPAIGN_AUTH_PROVIDER=dynamic` staged with `--skip-deploys`. No credentials were
removed and no deployment was triggered. The customer web build also needs
`NEXT_PUBLIC_CAMPAIGN_AUTH_PROVIDER=dynamic` and
`NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=4fc2a73c-1662-45eb-9257-8baa567066a6`, together
with simulation mode. Local equivalents were added to the existing local env
files. Roll back by selecting `privy` in both provider settings and rebuilding
the web app; keep all Dynamic settings and recovery access for funded users.
Do not roll back to a backend binary predating migration 0035 without a separate
schema compatibility plan.

The public Dynamic settings were checked: email authentication, automatic V3
EVM embedded wallets and external wallet funding are enabled. Only Ethereum
was listed in the dashboard network settings; the app explicitly overrides the
wallet network list to Monad 143. Configure Monad in the dashboard too for
consistency. No card/bank on-ramp providers are configured. Enable a provider
only after confirming it can deliver native USDC on Monad for the intended
users; we do not advertise an unavailable purchase method.

Dynamic's published native sponsorship chain list currently omits Monad.
Dynamic withdrawals therefore use an explicitly disclosed standard Monad
transaction and require MON for gas. There is no silent sponsored-to-paid
fallback. The platform testnet receipt worker continues to use its separate
Privy receipt wallet and configuration. Simulation confirmations still do not
request a wallet signature or spend real USDC.

Users can choose a connected external wallet with Monad/native USDC pinned in
the funding dialog, or use their deposit address/QR with another wallet or an
exchange supporting Monad. Credit grants still wait for server-verified
finalized token balances. Wallet/private-key export opens Dynamic's secure
export UI; Frenspay never handles or stores the exported key.

Validation includes `yarn check:dynamic` for signed-token failures and verified
identity binding, plus provider-isolated campaign creation and protection
against duplicate email grants. A real Dynamic email login, wallet creation,
funding, export and withdrawal still require operator acceptance testing.

Sources: https://www.dynamic.xyz/docs/auth/tokens
https://www.dynamic.xyz/docs/react/smart-wallets/evm-gas-sponsorship
https://www.dynamic.xyz/docs/embedded-wallets/gas-sponsorship
