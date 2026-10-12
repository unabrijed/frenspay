# Frenspay payments: setup, activation, and commit plan

Updated: 12 October 2026. This file lives in the Git/project root, above `monorepo/`.

## 1. Current status and intended launch

The implementation is local. Provider activation, shared-database migrations, deployment, and a live payment smoke test are still outstanding. No commits or pushes are performed by this guide.

The first release is a **closed web pilot**: hosted card funding → confirmed Solana USDC balance → supported merchant QR → verified receipt → split among Frenspay users. Start with an eligible APAC cohort and one participating merchant, with Singapore as the proposed first merchant test location. Country and card eligibility must be verified before inviting that cohort.

This is wallet funding followed by a wallet payment. It does not implement a Frenspay card vault or directly charge a saved card for every merchant scan. Card entry and any available saved-card functionality belong to the hosted provider. Frenspay does not store card numbers or CVVs.

Normal Frenspay screens do not expose provider selection or a chain picker. Provider names appear in this internal guide; required hosted disclosures remain visible. Operators currently support Solana mainnet USDC only. Another chain needs a tested implementation and a balance migration plan, not merely a configuration change.

Ordinary UPI, QRIS, PayNow, and arbitrary `solana:` payment requests are not enabled by this pilot. We currently have no Frenspay LP merchants; that is a separate route. A participating WalletConnect Pay merchant is required. Native card funding and merchant signing remain disabled pending device validation.

**Stage payments use mainnet and can move real money.** Local automated tests use mocks and isolated databases; they do not prove live provider eligibility.

## 2. What is required from the project owner

| Required item | Where to obtain it | Completion condition |
| --- | --- | --- |
| Existing Privy app access | [Privy dashboard](https://dashboard.privy.io) | Card onramps enabled for the app used by Frenspay |
| Country/card eligibility | Selected funding provider's onboarding and checkout | Intended pilot users can purchase USDC on Solana, with visible fees and limits |
| WalletConnect wallet project ID | [WalletConnect dashboard](https://dashboard.walletconnect.com) | Project ID configured on the backend and accepted by the payment SDK |
| Participating merchant/test checkout | Merchant/provider dashboard | Valid payment link offering a compatible Solana USDC route |
| Pilot accounts | Frenspay stage onboarding | Customer UUIDs collected and explicitly allowlisted |
| Information-form hosts, if required | Verified provider documentation or support | Exact HTTPS hostnames approved and configured |
| Deployment access | Railway, Vercel, database, GitHub | Correct stage targets selected and database backup/recovery available |

Do not create a new Privy app just to enable funding: existing identities and wallets belong to the current app. Do not put app secrets, RPC credentials, signed transactions, or card information in this document or Git.

If provider onboarding requires a registered business, that is a launch dependency. The project does not currently have a registered entity; do not infer production approval from successful dashboard registration.

## 3. Enable hosted card funding

1. Open the [Privy dashboard](https://dashboard.privy.io) and select the existing Frenspay app matching `NEXT_PUBLIC_PRIVY_APP_ID` and backend `PRIVY_APP_ID`.
2. Open **Funding**, then enable **Card onramps**.
3. Complete any onboarding shown for the applicable provider. Privy's current documentation lists default USD/EUR and AUD/BRL routes; additional fiat currencies require Meld KYB. Do not assume this enables SGD, INR, every APAC country, or every credit card. [Funding configuration](https://docs.privy.io/financial-flows/deposits/configuration).
4. Check the existing app's allowed origins for the actual stage web domain. Keep the current authentication and Solana wallet configuration intact.
5. During the closed pilot, verify the hosted checkout actually offers Solana USDC for the selected user's country/card. Record the displayed quote, funding fee, purchase minimum, and expected arrival time.
6. Keep the backend funding flag off until the app is deployed and the pilot UUID is configured. Enable it only for the pilot test described below.

Code entry point: [PaymentBridge.tsx](monorepo/apps/web/src/services/privy/PaymentBridge.tsx). The funding modal's exit callback does not credit money: the app relies on confirmed wallet balance. A canceled checkout must not increase the displayed balance.

## 4. Configure merchant payment access

1. Open the [WalletConnect dashboard](https://dashboard.walletconnect.com), select or create the Frenspay wallet project, and copy its project ID.
2. Save that ID as backend `STAGE_WCP_PROJECT_ID` for stage. The implementation uses the standalone Node SDK's `appId` configuration. It does not use the separately onboarded direct Gateway API. [SDK setup](https://docs.walletconnect.com/payments/wallets/standalone/web).
3. Obtain a participating merchant payment link or use the dashboard payment-testing workflow where available. Confirm that the selected checkout can offer **Solana USDC**. A wallet integration does not make an arbitrary local merchant QR compatible. [Wallet integration guide](https://docs.walletconnect.com/payments/wallets/overview).
4. Confirm the route fits the current implementation: one direct canonical-USDC SPL transfer, with an external fee payer. Mixed-chain routes, arbitrary program calls, and wallet-paid SOL fees are rejected. The app signs; the provider broadcasts. [Solana signing requirements](https://docs.walletconnect.com/payments/wallets/token-chain-support/solana-support).
5. If the payment option requires an information form, verify its host with the provider and add that exact hostname to `STAGE_PAYMENT_COLLECT_HOSTS`. Use comma-separated hostnames, without schemes, paths, ports, or wildcards. Do not approve an arbitrary hostname just because it appeared in a scanned link.
6. An empty host list deliberately refuses payments requiring a hosted form; payments without that requirement can proceed. Never disable the URL validation to make a test pass.

The dashboard test checkout may move real funds. Confirm the destination and use a deliberately small amount meeting provider minimums.

## 5. Configure the correct environment

All Yarn commands below run inside `monorepo/`. Git commands run from the project root.

```sh
cd /Users/brijeshagal/Projects/Brijesh/Projects/payments/monorepo
node --version
yarn --version
yarn install --frozen-lockfile
```

Use Node 24 or newer and Yarn 1.22.22. Deployment uses Node 24; the prior local validation used Node 25.9.0. Do not overwrite existing environment files wholesale.

Configuration references:

- Backend template: [apps/backend/.env.example](monorepo/apps/backend/.env.example).
- Web template: [apps/web/.env.example](monorepo/apps/web/.env.example).
- Backend tier resolution: [envConfig.ts](monorepo/apps/backend/src/envConfig.ts).
- Capability gating: [paymentPolicy.ts](monorepo/apps/backend/src/services/paymentPolicy.ts).

### Backend stage variables

In Railway, select project **fpay** → environment **stage** → service **frenspay-stage** → **Variables**, as documented in [DEPLOY.stage.md](monorepo/DEPLOY.stage.md). Verify those targets still match the live project before editing; they have not been remotely re-audited for this guide.

Merge these settings into the existing configuration, replacing the project-ID placeholder:

```dotenv
NODE_ENV=stage
STAGE_MERCHANT_PAY_ENABLED=false
STAGE_CARD_FUNDING_ENABLED=false
STAGE_WCP_PROJECT_ID=REPLACE_WITH_WALLET_PROJECT_ID
STAGE_PAYMENT_CHAIN=solana
STAGE_PAYMENT_POLICY_VERSION=solana-usdc-v1
STAGE_PAYMENT_PILOT_USERS=
STAGE_PAYMENT_COLLECT_HOSTS=
STAGE_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

Keep the existing stage database, authentication, RPC, and transfer configuration. The Solana RPC must serve mainnet; merchant transaction verification checks this. Empty `PAYMENT_PILOT_USERS` denies everyone, even when flags are true. Use customer database UUIDs, not handles, wallet addresses, or Privy IDs.

Backend tier rules:

| Runtime | Variable names |
| --- | --- |
| `NODE_ENV=stage` | `STAGE_<KEY>` |
| `NODE_ENV=production` | Bare `<KEY>`, such as `MERCHANT_PAY_ENABLED` |
| Local/development | `LOCAL_<KEY>`, with stage fallback |

The Privy app ID, app secret, and verification key are an exception: they use their existing bare names on every tier. Keep secrets backend-only. For isolated local work, explicitly configure a local database and local payment flags so stage fallback cannot accidentally select a shared database or enable a real-money flow.

### Web stage variables

In Vercel, select **frenspay-stage** → **Settings → Environment Variables**. Match the actual deployment environment; the `stage` branch is that project's production branch.

```dotenv
NEXT_PUBLIC_APP_ENV=stage
NEXT_PUBLIC_STAGE_API_URL=https://stage.api.frenspay.xyz
NEXT_PUBLIC_STAGE_SOLANA_RPC_URL=REPLACE_WITH_EXISTING_APPROVED_MAINNET_RPC_URL
NEXT_PUBLIC_PRIVY_APP_ID=KEEP_EXISTING_APP_ID
```

Preserve `NEXT_PUBLIC_PRIVY_CLIENT_ID` if already used. Public variables are browser-visible: use an appropriate browser RPC endpoint, not a privileged server credential. Rebuild/redeploy the web app after changing build-time public variables. No frontend WCP project ID or customer chain toggle is required.

For production, use `NEXT_PUBLIC_APP_ENV=production`, `NEXT_PUBLIC_API_URL`, and `NEXT_PUBLIC_SOLANA_RPC_URL` with the actual production endpoints, and bare backend payment variables. Do not copy stage database credentials into production.

## 6. Enroll the first pilot users

1. Onboard two test users through the existing Frenspay access/invite flow. Confirm each has a username and the intended Solana wallet.
2. Obtain their customer UUIDs from the authenticated `/me` response (`id`) or an authorized read-only database query. For example, replacing the handle with its actual stored value:

   ```sql
   select id, handle from users where handle = '@yourhandle';
   ```

3. Set `STAGE_PAYMENT_PILOT_USERS` to the comma-separated UUIDs. Start with only these users.
4. Leave both feature flags false until deployment and local checks are complete.
5. In the logged-in browser's Network panel, inspect `GET /payments/capabilities`. Both booleans should be false while the flags are off. Do not paste session tokens into shared logs.
6. After activation, an allowlisted user should receive `merchantPay: true` and/or `cardFunding: true` for the enabled feature. An unlisted user must still receive false.

The capabilities response also reports policy version `solana-usdc-v1` and funding target `{ "chain": "solana:mainnet", "asset": "USDC" }`. Merchant capability additionally requires a nonempty WCP project ID.

## 7. Validate before deployment

From `monorepo/`:

```sh
yarn check:payments
yarn check:payments:browser
yarn check:expenses
yarn check:expenses:db
yarn check:expenses:browser
yarn check:paytarget
yarn workspace @fpay/backend tsc --noEmit
yarn workspace @fpay/web typecheck
yarn workspace @fpay/mobile typecheck
yarn workspace @fpay/backend build
yarn workspace @fpay/web build
```

Browser checks need an installed Chrome browser; `PLAYWRIGHT_CHANNEL` can select an available alternative. The payment and expense database checks use isolated PGlite. They do not require applying migrations to a live database. `yarn check:all` does not include every payment/database/browser check above.

These checks passed during the preceding implementation work. Repeat them for the actual release revision, especially after separating commits. A nonblocking transitive SDK dynamic-import warning appeared in the web build. Live card funding, live merchant acceptance, and native-device payment tests have not been completed.

## 8. Migrate and deploy with features off

1. Confirm the target database and backup/recovery arrangements. Read the migration status before applying anything.
2. Review additive migrations [0032_friends_and_expenses.sql](monorepo/apps/backend/src/db/migrations/0032_friends_and_expenses.sql) and [0033_merchant_payments.sql](monorepo/apps/backend/src/db/migrations/0033_merchant_payments.sql). The normal runner applies **all pending migrations** in order, not just these two.
3. If applying from a correctly configured source checkout, run:

   ```sh
   NODE_ENV=stage yarn db:status
   NODE_ENV=stage yarn db:deploy
   NODE_ENV=stage yarn db:status
   ```

4. Alternatively, let the normal backend container startup apply migrations. The root Dockerfile runs `node dist/migrate.mjs deploy` before starting the server. In the deployed container, the status command is `node dist/migrate.mjs status` from `/app`; source-tree Yarn migration commands are not available there.
5. Deploy the selected backend revision through the existing **backend deploy** GitHub Actions workflow, targeting the `stage` branch. Confirm migration success and `/health` before promoting the matching web frontend.
6. Deploy/promote the matching web revision in Vercel. A push to `stage` can trigger both platforms independently; frontend completion does not prove backend readiness. Coordinate this release rather than assuming their builds finish in order.
7. Prototype retirement changes frontend entry routes and returns 410 for retired backend campaign actions. Coordinate the switch in a release window so an old prototype client is not left calling newly retired routes. Verify `/legacy-wallet` recovery with an existing account before finishing the rollout.
8. Keep payment flags off until the pilot users can sign in, balances load, and capabilities correctly deny non-pilot users.

Do not run `db:reset`, delete financial tables, clear all browser storage, or rewrite Git history. The intended refresh is the retired prototype plus stale product cache. Existing funds, financial records, identities, wallet access, and pending recovery data remain.

## 9. Activate and run the live pilot

1. With provider funding enabled and pilot UUIDs configured, set `STAGE_CARD_FUNDING_ENABLED=true` and apply/redeploy the backend configuration.
2. As one pilot user, open Add money. Cancel once and confirm the balance does not increase. Then complete a small eligible hosted card purchase. Confirm the quoted fee and wait for the actual USDC balance to arrive.
3. Once the merchant route and project access are ready, set `STAGE_MERCHANT_PAY_ENABLED=true` and apply/redeploy. Verify capabilities again.
4. Scan the participating merchant's QR. Check merchant identity, fiat amount, USDC debit, and expiry on the review screen. Complete an allowed information form if required.
5. Approve once. The client signs the reviewed transaction; the provider broadcasts it. Confirm the payment moves through processing and produces exactly one verified receipt. Provider success alone must not mark an unverified debit complete.
6. Test a reload while processing. Resume the same attempt and confirm a second debit/receipt is not created. A timeout is not permission to create a fresh merchant invoice and pay again.
7. From the confirmed receipt, create a split with the second Frenspay user. Check equal and custom shares, payer remainder, and settlement confirmation. The merchant receives one payment; participants reimburse the payer.
8. Check username and phone lookup for an existing Frenspay user. For a non-user, verify the SMS invite composer opens and leaves sending to the user. Joining is required before that person can participate in a Frenspay split.
9. Confirm an ordinary national QR and an unsupported route are refused. Confirm a non-pilot user cannot activate these features. Verify external fee payment with a wallet that has no SOL; do not weaken validation if the provider's route cannot support it.
10. Record the release revision, country, card/provider route, amounts/fees, merchant attempt ID, confirmed transaction, and result in a private release record. Exclude card details and signed transaction payloads.

Only expand the allowlist after the complete funding → merchant payment → receipt → reimbursement journey succeeds. Provider quotes determine available rates and fees; do not advertise universal card acceptance, universal QR coverage, or a guaranteed conversion rate.

## 10. Monitoring, disabling, and recovery

Watch `merchant_payment_completed`, `merchant_payment_failed`, `merchant_payment_retry`, and `merchant_payment_receipt_wait`. Investigate aging processing rows with a read-only query:

```sql
select id, status, amount_fiat, currency, amount_usdc,
       transfer_id, created_at, updated_at, next_poll_at
from merchant_payments
where status = 'processing'
order by created_at asc
limit 50;
```

To stop new approvals, set the target tier's `MERCHANT_PAY_ENABLED=false`; disable `CARD_FUNDING_ENABLED` separately if needed. These switches do not cancel transactions already submitted or reverse a completed funding purchase.

Keep the backend recovery worker, database, provider credentials, and original RPC access running. Submitted attempts continue reconciliation even when new payments are disabled. Prefer disabling flags over rolling back to code that cannot reconcile existing attempts. Do not drop the new schema or manually mark uncertain payments completed.

Cache version 3 refreshes cached identity, balance, activity, and rates. It preserves authentication/wallet state and pending deposit, merchant payment, bill transfer, and legacy withdrawal recovery keys. Existing prototype users retain the legacy wallet route. Do not replace this migration with `localStorage.clear()`.

## 11. Proposed commit sequence

This is a plan only. The working tree contains overlapping access, friends, payments, prototype, and landing changes. Commit boundaries require reviewing hunks; whole-file staging of shared files may mix features.

| Order | Proposed commit message | Scope and review boundary |
| --- | --- | --- |
| 1 | `feat(access): unify customer invite and f-list access` | Existing f-list backend/shared contracts, customer access and login handoff, related auth/waitlist/middleware/gate changes and tests. Review as a prerequisite; do not accidentally include unrelated landing visuals. |
| 2 | `feat(splits): add friends and durable bill reimbursements` | Migration 0032; friends/expenses routes, database helpers, recovery worker, shared expense/SMS contracts, username/phone lookup, user-composed invitations, shared web/mobile split UX, supporting UI changes and expense tests. Keep this feature coherent across client and server. |
| 3 | `feat(payments): add verified Solana merchant payment backend` | Migration 0033; payment policy, merchant service/transaction validation/routes, SDK dependency, shared payment contracts/QR parser, receipt-feed and split eligibility changes, worker/rate-limit registration, backend tests, backend env template. Include the matching shared QR checks. |
| 4 | `feat(web): add hosted funding and merchant checkout` | PaymentBridge, sign-only web signer, MerchantPayment sheet/service, AddMoney and scan integration, capability handling, bridge registration, error handling, and browser payment tests. Preserve native-disabled behavior. |
| 5 | `refactor(product): retire prototype and refresh stale cache safely` | Main entry/provider routing, retired prelaunch endpoints, legacy wallet route/recovery/withdrawal verification, settings access, cache version migration, and relevant recovery/cache assertions. Keep preserved wallet recovery usable throughout the release. |
| 6 | `docs(payments): document pilot activation and release steps` | This root guide, deployment/readme updates, historical prototype documentation, and any remaining configuration explanations. |
| Separate | `style(landing): refine landing presentation` | Unrelated visual edits in the landing app, only after their own review. Landing access functionality required by commit 1 belongs there instead. |

Shared files needing particular care include `envConfig.ts`, `routes/index.ts`, `server.ts`, `db/queries.ts`, shared exports/contracts, app `store.ts`, sheet registry, web `AppProviders.tsx`/`PrivyRoot.tsx`/`PrivyBridge.tsx`, and workspace manifests. Some test files exercise both payments and cache retirement; stage those assertions with their implementation or move the full test to the later commit and document that dependency.

For every dependency change, keep each manifest and its matching `yarn.lock` changes together. Do not place the combined final lockfile into an early commit whose manifests are incomplete. Resolve overlapping lockfile changes against that commit's manifests and check `yarn install --frozen-lockfile` in an isolated checkout.

### Commit preparation commands

From the project root, inspect first:

```sh
git status --short
git diff --stat
git diff -- monorepo/apps/backend/src/routes/index.ts
```

Stage reviewed hunks for overlapping tracked files, for example:

```sh
git add -p -- monorepo/apps/backend/src/routes/index.ts
git diff --cached --stat
git diff --cached
git diff --cached --check
```

Add new files by explicit path for the chosen feature; `git add -p` alone does not pick up untracked files. Avoid `git add .` for this working tree. For the final documentation commit, this guide's exact staging path is:

```sh
git add -- PAYMENTS_SETUP_AND_COMMIT_PLAN.md
```

Validate each proposed commit in an isolated checkout/worktree before finalizing the series: tests run against the full dirty working tree do not prove an individual staged snapshot builds. Run the relevant access/expense/payment tests at their corresponding boundaries, followed by the complete release checks in section 7 on the final revision.

Commits are review units, not independent deployment units. Prepare the whole coherent series before updating an auto-deploy branch. Do not push partial feature commits to `stage` just to save progress. Coordinate the deployment described in section 8, then promote to production only after the pilot acceptance checks pass. No push, deployment, or production enablement is implied by creating this file.
