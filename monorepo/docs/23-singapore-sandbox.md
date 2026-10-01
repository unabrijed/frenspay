# Singapore PayNow — recognition and isolated StraitsX sandbox

> **Monad prelaunch update (2026-10-01):** The new optional Monad campaign can simulate PayNow scans without invoking this StraitsX adapter. The recognition-only behavior below still applies to legacy web/mobile. See the campaign document for separate funding and points rules. See [24 — Monad prelaunch](24-monad-prelaunch.md).

## What is available

Web and mobile recognise business UEN and Singapore mobile-number PayNow QRs, including PayNow
inside multi-scheme SGQR. Scanning displays **Singapore payments aren’t available yet**. The QR's
recipient name is not bank-verified. Bare phone numbers still use the existing fpay directory.

Validation covers complete TLV structure, duplicate/conflicting fields, CRC-16, SGD (`702`),
country `SG`, amount precision, fixed/editable amounts, references and expiry. Date-only expiry
lasts through that Singapore calendar day; 14-digit expiry is an exact Singapore local timestamp.
NRIC/VPA proxies, extra fee instructions, unknown PayNow-specific instructions and SGQRs without
PayNow fail closed. Existing UPI/QRIS parsing is unchanged.

SGD has 2 decimal places and joins the FX refresher. `FX_FALLBACK_RATE_SGD` defaults to `1.35`,
with a plausibility band of `0.5–2.5`. This is a fallback, not a current market quote.
SGD is available for balance display and currency preferences, formatted as `S$`; displaying SGD
does not enable PayNow. Older saved rate maps retain the new fallback during hydration.
Solana, USDC deposits, escrow and existing fees are unchanged. No Monad migration is included.

## Safety boundary

- PayNow is explicitly non-quotable and closed to LP registration. No Singapore platform
  settlement merchant or treasury is provisioned.
- Migration `0030_singapore_sandbox.sql` extends payout-method constraints and inserts a disabled
  `straitsx_sg_sandbox` row. It does not change historical migrations or existing funds.
- Real-order provider selection and sticky recovery refuse this sandbox ID, adapter and rail,
  even if a database row is enabled. The wildcard simulator cannot serve PayNow.
- Confirm rechecks the quote's rail before wallet/escrow work. The worker freezes any unexpected
  Singapore order for review, including one already marked paid.
- Admin shows **sandbox only · unavailable**; enabling returns `409 provider_sandbox_only`.
- Sandbox callbacks have no order/ledger/escrow dependencies and never claim a real payment.

Apply the additive migration through the normal reviewed deployment workflow. **Do not run
`db:seed` or reset an existing database** to register this provider.

## Configuration and verification

Use StraitsX's standard API-key authentication mode on a sandbox Business Account. This first
adapter does not support accounts requiring HTTP request signing; they fail closed rather than
bypass it. See [authentication methods](https://docs.straitsx.com/docs/authentication-methods).

Optional backend variables follow existing tier rules: local reads `LOCAL_` then `STAGE_`, stage
reads `STAGE_`, production reads bare names. Keep these server-side, and normally unset on production:

| Variable base name | Purpose |
|---|---|
| `STRAITSX_SANDBOX_API_KEY` | Sandbox API access |
| `STRAITSX_SANDBOX_SIGNING_SECRET` | Raw-body callback verification |

The host is fixed to `https://api-sandbox.straitsx.com/v1`; there is no production override.
Redirects are refused. Errors never log provider bodies or secrets. Payouts explicitly select
`walletSource: "sgd"`, not the API's default XSGD balance. No USDC funding, swaps or bridges occur.
The adapter takes an explicit profile ID; it does not assign existing users a shared profile.

From `monorepo/`, run offline checks:

```sh
yarn check:paynow
yarn check:straitsx
yarn check:rails
yarn check:fx
yarn typecheck
```

The external smoke test is opt-in and requires a working sandbox key:

```sh
yarn workspace @fpay/backend smoke:straitsx
yarn workspace @fpay/backend smoke:straitsx --run
```

Without `--run`, it prints **SKIPPED: external verification pending** and makes no API requests.
With `--run`, it creates a synthetic profile, simulates verification, adds SGD 10 in virtual
balance, and tests UEN/mobile payouts with documentation-example proxies. It checks duplicate
initiation, simulates completed/failed outcomes and polls the authoritative API. It never reads
real users, creates app orders or touches on-chain funds. Each run leaves synthetic sandbox records
for inspection; do not substitute real identity data. If the account lacks the required product
permissions, ask StraitsX to enable the sandbox third-party transfer APIs.

### Callbacks

In the **sandbox** dashboard, configure the payout callback URL:

```text
https://<backend-host>/webhooks/straitsx/straitsx_sg_sandbox
```

Set the active signing secret for that backend tier. `Xfers-Signature` is checked against the
original request bytes with HMAC-SHA256 and constant-time comparison. Missing/invalid signatures
return 401; malformed signed JSON returns 400. Valid callbacks, including duplicates, return
`{ "ok": true, "sandboxOnly": true }` and log a bounded contract ID only. Existing webhook parsers
are unaffected. No application payment state changes.

Verify actual delivery separately using the sandbox dashboard and the backend log:
`sandbox callback received; no payment state changed`. The API smoke test does not establish
that callbacks reach this deployment.

### Retry and status rules

Payout creation uses one `idempotencyId`; retrieval accepts that key in place of a contract ID.
Existing results must match amount, destination and external reference. Concurrent identical
requests share one operation. A timeout, HTTP error, missing record or malformed response is
unresolved, not proof that no money moved. Keep the original reference when retrying; never
substitute a new reference. Only `completed` maps to paid and explicit `failed` maps to failure;
unknown statuses remain pending.

Production return reconciliation remains future work: StraitsX documents that a later bank return
may appear as a **separate deposit**, while the original payout stays completed. Do not assume
every return changes the payout to `reversed`.

## Production activation remains separate

A key, healthy endpoint or enabled row is not launch approval. A later production release must
establish the approved business/use-case model, QR coverage, per-user profiles/KYC, permitted
customer-wallet funding, SGD prefunding, fees, returned-payment reconciliation, refunds and
monitoring. Standard Business Account third-party private-wallet restrictions are not resolved
by this integration. Singapore should then use provider-only settlement without an LP marketplace.
No live activation flag is provided prematurely.

Sources for this integration:

- [Create customer profile](https://docs.straitsx.com/reference/create-a-personal-customer-profile)
- [Create payout recipient](https://docs.straitsx.com/reference/create-a-customer-profile-payout-recipient)
- [Create payout](https://docs.straitsx.com/reference/create-a-third-party-payout)
- [Retrieve payout by ID or idempotency key](https://docs.straitsx.com/reference/get-a-third-party-payout-customer-profile)
- [Callback signatures](https://docs.straitsx.com/docs/securing-your-callback)
- [Payout and returned-funds behavior](https://docs.straitsx.com/docs/payout-faqs)
- [Business wallet restrictions](https://support.straitsx.com/support/solutions/articles/157000366362-how-do-i-whitelist-a-blockchain-address-for-my-business-account-)

Until the opt-in API smoke test and deployed callback delivery pass with provisioned credentials,
external verification is pending. Offline tests are not production-readiness approval.
