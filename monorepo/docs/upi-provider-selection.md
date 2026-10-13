# Frenspay UPI provider selection

Frenspay needs to let a beta customer scan an ordinary Indian merchant UPI QR, approve a USDC debit, and have the merchant receive INR. The founder confirmed on 12 October 2026 that the experiment is unincorporated, has no Indian business bank account, and has neither a payout-provider account nor a manual settlement partner.

No provider reviewed below has yet been confirmed to support this complete flow for Frenspay. The immediate next step is provider eligibility and product confirmation. A generic UPI checkout integration, a personal bank withdrawal, or enabling WalletConnect payments would not satisfy the chosen product requirement.

## Production findings

Read-only inspection of the production database found no UPI payout provider and no online eligible UPI partner. The current scanner rejects UPI codes. Existing QR parsing, quoting, escrow and reconciliation code can be reused, but there is no service currently available to pay the INR leg.

The configured payment pilot account exists and has a Solana wallet, but it lacks redeemed-invite membership. Its access needs to be repaired through the normal invite flow before authenticated customer testing. Membership and payment allowlisting are distinct gates.

## Provider findings

| Candidate | Documented capability | Fit for this experiment |
| --- | --- | --- |
| Onmeta | Solana USDC off-ramp; separate platform USDC-to-INR bank payouts | First eligibility inquiry. Published documentation does not establish arbitrary merchant UPI payment support or acceptance of an unincorporated beta. |
| Cashfree Payouts | INR payouts to VPAs using supported fund sources | Conditional INR-leg candidate only. No existing business bank account or approval of Frenspay's USDC-funded model. |
| Onramp Money | Off-ramp with beneficiary bank-account registration and provider KYC | Potential bank-withdrawal product; reviewed documentation does not establish the requested merchant QR flow. |
| RazorpayX | Bank and UPI payouts | Do not select for the current model: published terms exclude crypto-related activity. |

Onmeta's off-ramp guide lists Solana and USDC, but requires a linked user bank account matching KYC. Its separate cross-border payout page describes platforms sending USD or USDC for delivery to Indian bank accounts. Neither statement proves support for scanning an unrelated merchant's UPI QR. [Off-ramp guide](https://docs.onmeta.in/docs/guides/offramp-integration-flow/), [platform payouts](https://onmeta.in/cross-border-payouts-to-inr).

Onmeta's published onboarding asks for entity and beneficial-owner details and company documents. Its FAQ requires production API access and server IP allowlisting. Ask explicitly whether there is an eligible unincorporated or sole-proprietor pilot route; do not assume one exists. [Onboarding](https://docs.onmeta.in/), [integration FAQ](https://docs.onmeta.in/docs/widget/faq/).

Cashfree currently states that UPI payouts from `CF_WALLET` are disabled at platform level. Its connected-bank matrix lists supported UPI bank routes. Its public capability documentation is not approval of this crypto-funded use case. [Payout methods](https://www.cashfree.com/docs/payouts/payouts/make-payouts/payout-methods), [connected banks](https://www.cashfree.com/docs/payouts/payouts/fund-management/bank-account).

Onramp Money's reviewed integration flow uses a registered `fiatAccountId` for off-ramp payouts. That is not evidence of open merchant QR payments. [Integration guide](https://docs.onramp.money/onramp-whitelabel-unlisted).

RazorpayX General Terms clause 2.14(e) excludes activity related to virtual currency and cryptocurrency. Do not present the standard product as an eligible USDC-to-UPI solution. [RazorpayX terms](https://razorpay.com/x/terms/).

## Provider inquiry draft

This draft is prepared for the founder to review and send. No provider has been contacted.

**Subject: Eligibility and API support for a small USDC to merchant UPI beta**

We are building Frenspay, an experimental invite-only wallet at https://app.frenspay.xyz. Customers use Privy embedded Solana wallets holding USDC. We want a customer to scan an ordinary Indian merchant's UPI QR, review an INR amount and USDC quote, authorize the payment, and have the merchant receive INR with a verifiable bank reference.

We are currently unincorporated, have no Indian business bank account, and are evaluating a low-volume beta. Please confirm whether you can support this exact use case and onboarding status before we implement against your APIs.

1. Can you pay a third-party merchant VPA parsed from its existing QR, or do payouts only go to a KYC-matched user's own bank account? Is merchant onboarding required for every recipient?
2. Can an unincorporated founder or sole proprietor access a supervised beta? If not, which entity, jurisdiction and banking prerequisites apply?
3. Can you accept Solana mainnet USDC and perform the conversion and UPI settlement together? If a separate prefunded INR account is required, who owns it and which account types are eligible?
4. Which API product supports this? Please share its sandbox access, production requirements, supported QR types and recipient fields.
5. What KYC must the payer and recipient complete? Can your hosted flow handle it?
6. What are the minimum payment, fees, FX quote lifetime, funding requirements and settlement-time expectations for small retail purchases?
7. Do you expose recipient-name validation, idempotent payment creation, authoritative status lookup, UTR, signed webhooks, reversals and refunds? How do we recover an ambiguous timeout without paying twice?
8. What must pass before a small live pilot can begin?

Please distinguish supported production capabilities from sandbox simulations. We are not seeking personal P2P settlement or a way to relabel the source of funds.

Onmeta's official [sales contact](https://onmeta.in/contact-sales) is the first suggested inquiry because its published product already includes USDC-funded INR delivery. This is an eligibility inquiry, not a provider selection or endorsement of merchant UPI coverage.

## Implementation after product confirmation

The provider's actual settlement model determines the adapter. The existing `PayoutProvider` abstraction assumes INR is paid from an already-funded provider account and USDC escrow is released afterward. An off-ramp API that first requires a crypto deposit is not a drop-in implementation of that interface.

| Work | Concrete result |
| --- | --- |
| Provider onboarding | Approved use case, sandbox credentials and specified live prerequisites |
| Customer identity | Provider-hosted KYC linked to the existing user; status gates payment preparation |
| QR and recipient handling | Parse UPI, validate supported QR fields, verify recipient through provider, display recipient and INR amount |
| Quote | Bind recipient, INR amount, exact USDC debit, fees, expiry and provider quote ID |
| Funding | Implement the approved direct-deposit or prefunded-INR model, with explicit ownership and reconciliation |
| Payment orchestration | Persist provider ID and idempotency reference before external requests; track funding and fiat settlement independently |
| Confirmation | Require authoritative paid status and the supported bank reference; never equate HTTP acceptance with payment success |
| Recovery | Poll after timeout/restart, deduplicate callbacks, preserve pending payouts, and refund only after ruling out a completed or still-pending INR payment |
| Pilot access | Restore invited membership for test users; enforce payment allowlist, approved amount limits and a stop-new-payments control |
| Acceptance | Observe a small authorized INR credit to the merchant and match it to the USDC debit, provider record and receipt |

The reusable code is in `packages/shared/src/payTarget.ts`, `packages/app/src/sheets/pay.tsx`, `apps/backend/src/services/quoteEngine.ts`, `services/orderMachine.ts`, `services/payout/provider.ts` and `services/confirmer.ts`. Reconnect the scanner only when the selected backend capability is available; do not route an unsupported provider model into the old escrow sequence.

## Work that can proceed before approval

Use provider sandbox credentials to implement its exact API contract once eligibility and product fit are confirmed. Run sandbox fiat and test-token flows in an isolated database and environment; the existing stage deployment uses real Solana mainnet money and is not a sandbox.

An external UPI-app handoff could make a separate INR-from-bank experiment functional, but it would debit the user's bank account rather than their Frenspay USDC balance. It is a different product and needs an explicit product decision. A return from another app is not proof of payment.

If no provider accepts the unincorporated merchant-payment beta, live activation remains blocked on the provider's stated onboarding requirements. A sandbox demonstrates the flow but must not be described as a real merchant payment. No production flags, provider rows or customer balances were changed during this investigation.
