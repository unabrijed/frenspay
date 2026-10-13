# Frenspay production pilot

> Superseded launch direction, 13 October 2026: ship the [Monad UPI simulation beta](simulation-beta.md). The audit below records the earlier real-payment pilot and is historical evidence, not authorization to activate real UPI settlement.

The launch target is an invite-only production pilot with limited users. The existing API is deployed; public access to the customer experience and enabled money flows require separate verification. This runbook records the 12 October 2026 audit and the remaining steps to admit the pilot cohort.

The founder subsequently selected ordinary Indian UPI merchant QR payments as the first required capability, using gateway integrations rather than manual partners. There is no incorporated entity, Indian business bank account or contracted provider yet. **Live UPI activation depends on establishing an eligible provider route.** The [provider selection brief](upi-provider-selection.md) records the researched options and exact questions to resolve. Wallet-only or WalletConnect testing is not acceptance of the UPI launch objective.

## Existing production target

| Item | Observed value |
| --- | --- |
| Railway project | `fpay`, `5b699d03-84a2-48a2-9fdf-a59bdf16d016` |
| Environment | `production`, `e783c878-048c-4982-b256-e540e1351039` |
| Service | `frenspay-prod`, `d1b98980-37a6-46cd-bb5d-6138668d9179` |
| API | `https://api.frenspay.xyz` |
| Active deployment | `1b30f03b-7153-4bf3-bdcb-f1a6d81ec58b` |
| Deployment created | 12 October 2026 at 12:14:53 UTC |
| Railway state | Successful, one running instance in Asia Southeast |
| Health target | `/health`, 120-second timeout |
| Start sequence | Docker CMD runs migrations, then the API |
| Direct health request | HTTP 200, `status=ok`, `database=configured` |

The Railway deployment metadata does not identify a Git commit. A successful deployment is not evidence that it contains all changes in this checkout.

A subsequent database inspection used an explicitly read-only transaction and verified the production tier. The sole configured payment pilot ID resolves to an active user with a Solana wallet, but that user lacks redeemed-invite membership. Both UPI partner rows are offline and neither meets the stake/waiver gate. The only payout-provider row is the disabled Singapore sandbox provider. There are no recorded WalletConnect merchant payments. These findings establish that UPI has no operational settlement route in the current production database.

Direct HTTP probes also returned 200 for `app.frenspay.xyz`, `frenspay.xyz` and `admin.frenspay.xyz`; `provider.frenspay.xyz` returned 401. The API's `/flist/me` and `/payments/capabilities` returned 401 without authentication, as expected. These checks establish reachability and basic denial behavior, not successful authenticated journeys. Verify the provider site's access gate before including LP settlement in the pilot.

## Configuration findings

Only presence was inspected for credentials; no secret values belong in this document.

| Area | Production observation | Pilot implication |
| --- | --- | --- |
| Database and identity | `DATABASE_URL`, Privy app/secret and root admin list are set | Verify actual sign-in and account provisioning |
| Browser origins | Landing, www, app, admin and provider origins are listed in CORS | Verify each frontend targets this API |
| Solana | RPC, mint, fee payer, escrow, earnings and stake addresses/keys are set | Presence does not prove correct addresses, funds or sponsorship |
| Scan and pay | `MERCHANT_PAY_ENABLED=false`; WCP project and pilot users are set | New merchant payments remain disabled |
| Card funding | `CARD_FUNDING_ENABLED=true` | Capability is allowlisted; complete provider handoff still needs verification |
| Collection pages | `PAYMENT_COLLECT_HOSTS` absent | Payments needing an external information page cannot proceed until trusted hosts are configured |
| Identity verification | Didit variables exist; `KYC_PROVIDER` and Persona credentials are absent | This checkout does not activate Persona checks from Didit variables |
| Invitations by email | Waitlist secret exists; Resend key and email sender are absent | Verify code redemption separately from email delivery |
| Webhook registration | Helius key/secret exist; `PUBLIC_BASE_URL` absent | Automatic Helius registration is skipped by this checkout; polling remains relevant |
| Cross-chain settlement | EVM RPCs exist; EVM minter private key absent | Do not include cross-chain settlement in the initial pilot |

Do not replace any working production secret merely to match an example file. Align the selected capability with the existing provider account, supported flow and verified wallet addresses.

## Validation and local fixes

The audit made these local changes:

- Included the mobile and shared app manifests in the Docker dependency layer. Mobile source remains excluded while its manifest is available to Yarn.
- Excluded wallet keypair JSON files from Docker context, matching the repository's secret-file naming conventions.
- Updated shared payment copy to pass the existing product-copy gate, and taught that gate to ignore internal discriminant comparisons.
- Updated the isolated invite-access test to expect `campaign_retired` from the retired campaign and verify access to current customer endpoints instead.
- Added the scan-and-pay pilot variables to the production environment reference.

Validation results:

| Check | Result |
| --- | --- |
| Nine workspace TypeScript checks | Passed |
| `yarn check:all` | Passed with Node 25.9.0 |
| Backend server and migration bundles | Passed |
| Web, admin, LP and landing production builds | Passed; Privy dependency emitted dynamic-import warnings |
| Isolated payment SQL and HTTP tests | Passed |
| Isolated expense SQL and HTTP tests | Passed |
| Isolated invite redemption and access tests | Passed after retired-campaign expectation update |
| Payment browser checks | Passed: review, signing, receipts, reload recovery, funding and cache preservation |
| Expense browser checks | Passed: people, invitations, shares, review races and wallet recovery |
| Docker manifest coverage | All nine workspace manifests present before dependency installation |
| Full Docker image build | Not run; local Docker daemon unavailable |
| Live authenticated payment and refund | Not run |

The machine's default Yarn subprocess path initially selected Node 20 and failed a timezone assertion. Selecting the installed Node 25 runtime made the full check suite pass. Deployment remains pinned to Node 24; final CI/image verification must use that pinned runtime. Local Next builds loaded local environment files and prove compilation, not the correctness of Vercel production variables.

These fixes are local changes. This audit did not deploy a new version, alter production variables, run production migrations or move funds.

## Launch sequence

1. **Choose the exact customer capability.** Start with verified invite onboarding, wallet receive/send and expenses. Keep scan and pay disabled until an approved test user completes its provider flow. The current UI does not support UPI or QRIS settlement, even though legacy backend routes remain.
2. **Verify the release and database.** Record the source commit for the intended release, check database ownership and migration status, and confirm a current backup. Use the existing production database; never seed or reset it. The image applies migrations before serving traffic.
3. **Verify frontend configuration.** Check production Vercel projects for `NEXT_PUBLIC_APP_ENV=production`, `NEXT_PUBLIC_API_URL=https://api.frenspay.xyz`, the intended Privy app/client, allowed origins and Solana RPC. Customer middleware in this checkout is a pass-through; the API's verified identity and F-list membership are the actual access boundary.
4. **Verify identity and operations.** Sign in with the configured root admin. Confirm the intended identity-verification mode: Didit variables alone do not turn Persona on. Verify fee payer funding or sponsorship, wallet roles, invite delivery and operator access without printing secrets.
5. **Admit a small cohort.** Issue invitations through the admin flow. Test one redeemed code, one reused code and one uninvited identity. Members receive onward invitations, so track membership growth; a fixed-size pilot requires an additional admission policy. Populate payment pilot IDs from real backend accounts, not email addresses.
6. **Exercise the selected flow.** Verify login persistence, refresh/reopen recovery, balances, receive, a deliberately small user-approved transfer and an expense split. For scan and pay, configure required collection hosts, validate the WCP account and allowlist, then enable it for the chosen IDs and verify completion against chain evidence. Record transaction and payment IDs without credentials.
7. **Release compatible artifacts.** Build and verify the Node 24 image, deploy backend changes through the existing Railway pipeline, verify health and current routes, then promote the matching web release. Publish a release identifier in the operational record so UI/API version alignment can be checked.
8. **Observe before expanding.** Watch HTTP failures, pending transfers, processing payments, reconciliation age, wallet gas and customer reports. Expand invitations only after the initial cohort's full journeys succeed.

## Recovery

Keep the previous successful Railway deployment available. Application rollback does not reverse database migrations; use backward-compatible schema changes and forward fixes. Never reset production to recover a deployment.

`MERCHANT_PAY_ENABLED=false` stops the new merchant-payment capability; `CARD_FUNDING_ENABLED=false` hides its funding capability. Neither is a universal stop for P2P or existing settlement work. Preserve signer/provider configuration needed to reconcile already-processing payments. Use admin suspension for affected customer accounts and inspect in-flight transactions before changing custody keys or restarting settlement paths.

## Commands

Run application commands from `monorepo/` with Node 24 and Yarn 1.22.22. Inspect the selected database tier before running any database command.

```sh
yarn typecheck
yarn check:all
yarn check:payments
yarn check:expenses:db
yarn check:payments:browser
yarn check:expenses:browser
yarn workspace @fpay/backend build
yarn workspace @fpay/web build
yarn workspace @fpay/admin build
yarn workspace @fpay/lp build
yarn workspace @fpay/landing build
```

Read-only Railway target check from any directory:

```sh
railway status --project 5b699d03-84a2-48a2-9fdf-a59bdf16d016 \
  --environment e783c878-048c-4982-b256-e540e1351039 --json
curl --fail https://api.frenspay.xyz/health
```

Avoid copying raw `railway variable list --json` output into logs or chat; it includes secrets. Use a redacted presence report when reviewing configuration.
