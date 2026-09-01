# 14 · Onboarding when the identity vendor is off

> **Shipped 2026-08-29, audited and corrected the same day.** The first version of this also granted
> approved partners KYC tier 2. That was removed — §The grant that isn't explains why, and it is the
> most useful thing in this doc.

## The problem

Persona gates tier 2. Tier 2 gated `/merchants/apply`. Persona has no production key until its
compliance review clears (§Getting a production key in [10-ops-and-roadmap](10-ops-and-roadmap.md)),
so **nobody could become a partner at all** — the marketplace in [11-lp-console](11-lp-console.md) had
no way to admit its first human.

Blanking the credential in Railway was the intended way to say "the vendor is off". It wasn't:
`assertKycConfig` threw, `server.ts` exits 1 on any boot throw, and the deploy crash-looped.

## The switch

`config.personaLive` (`apps/backend/src/envConfig.ts`) is the single source of truth:

```
personaLive = KYC_PROVIDER is 'persona'  AND  the API key is real  AND  the template id is real
```

All three clauses are switches, and **any one of them turns the vendor off**.

`KYC_PROVIDER` is the front door: name it `persona` and checks run, leave it unset and they don't.
There is no fallback on a deployed tier — it used to default to `'persona'`, which meant the provider
name could never express "off" and only a credential could. The trade is deliberate: a *forgotten*
`KYC_PROVIDER` now reads as off rather than on, so the boot warning names it alongside the
credentials, and **`KYC_PROVIDER=persona` must be set explicitly on any tier meant to run checks**.
Local still defaults to `sim`.

"Real", for the two credentials, means non-empty, not placeholder-shaped, and **carrying the right
prefix** — `persona_sandbox_` / `persona_production_` for the key, `itmpl_` for the template. So
blanking either one turns the vendor off, and `changeme` does not read as a credential.

| | vendor on | vendor off |
|---|---|---|
| `POST /kyc/verify` | starts a hosted inquiry | `503 kyc_unavailable`, before any network call |
| KYC reconciler | polls every 15s | stands down (no sessions are ever created) |
| boot probe | one `persona probe:` line | silent; one loud config warning instead |
| `POST /merchants/apply` | requires tier 2 | no tier gate |
| KYB approval | approves a business | approves a business — **and nothing else** |
| payer surfaces | "Verify identity" card on Home + Settings | **nothing** — the card does not render, and the verify sheet is unreachable |
| LP `/identity` | the hosted check | redirects to `/apply`, silently |
| `/me.identityCheckAvailable` | `true` | `false` |

`assertKycConfig` still refuses to boot for exactly one configuration: a `persona_sandbox_…` key on a
production tier. A sandbox key never sees a real document, so booting prod with one would hand out
tier 2 for test data — worse than not booting.

Thirteen scenarios are asserted in `apps/backend/scripts/check-kyc-switch.ts` (`yarn check:kyc`, in
`check:all`). It spawns a process per case because `envConfig` reads `process.env` once at load; the
whole failure mode is env-shaped and invisible to `tsc`.

## What replaces the vendor

**Nothing new.** The partner application already collects a 13-field business form
(`packages/shared/src/kyb.ts`), a human already reads it in a queue that already exists
(`/admin/merchants`), and that review already has four outcomes, a mandatory applicant-visible note, an
append-only timeline and an audit row. The screening block is close to field-for-field with the
questionnaires peer platforms use before letting anyone in.

Two things were added so it can carry an identity decision:

- **`KybField.identity`** marks the one required field naming the *person* rather than the business.
  India has PAN. Indonesia gained NIK (the 16 digits on the KTP) — NIB and NPWP are both about the
  business. `check-kyb` asserts exactly one required identity field per country, so a new corridor
  cannot ship without one.
- **`contactTelegram`**, optional. `/merchants/apply` already refuses without a contact number, so
  nobody is unreachable; this is here because with the vendor off the review becomes a conversation.

**No documents are collected.** Nothing in this repo stores files, deliberately
(`0016_merchant_kyb.sql`), and that has not changed. The reviewer asks for whatever they need over the
contact channel. This is honest about what it is: a human judging typed identifiers and a stated
intent, not document verification.

## The grant that isn't

The first version of this granted the owner tier 2 on KYB approval, reasoning that an approved partner
would otherwise sit at tier 1 unable to cash out. **Both halves of that were wrong**, and the audit is
worth keeping because the mistake is an easy one to make again.

**Every `kyc_tier` gate in this codebase is payer-side.** External unhosted-wallet sends
(`routes/money.ts`), cross-chain withdrawal (`routes/crosschain.ts`), the send and cash-out limits
(`services/compliance.ts`) — plus the apply gate itself, which is already conditional on the vendor
being live. `merchantOps`, `routing` and `listRoutableMerchants` never read a tier: a partner takes
orders, reports paid, goes online and is routed on `kyb_status` + `bond_usdc` + `status`. And cash-out,
the notional prize, returns `503 payments_unavailable` on both deployed tiers anyway while the escrow
program is undeployed on mainnet.

So the grant bought the partner a capability they already had, and paid for it with $1,000-per-transfer
unhosted-wallet sends and 10× payer limits on real money.

Deleting it also deleted six problems that only existed to support it:

- `setKycSession` overwrites `kyc_provider` the moment a re-check *starts*, so the `'manual'` sweep
  list was lossy before anyone ran it;
- approving an already-Persona-verified owner rewrote their provenance and their verification date;
- a failing grant threw past the audit row, leaving two writes and no trail, unretryable (409);
- the console inferred "the vendor must be off" from the owner's tier and would lie once it was back on;
- **nothing in this codebase can lower a tier**, so a manual grant survived a later vendor *decline*;
- and a suspended owner could still be granted one.

The rule this leaves behind: **approve the business, and leave the person's tier to a real vendor.**

## The risk that remains

A partner is admitted on a human's reading of a form rather than a vendor's identity check. That is a
real exception to the rule in [08-compliance-and-legalities](08-compliance-and-legalities.md) that no
real payout precedes a real KYC/AML vendor, and it was taken knowingly on 2026-08-29 to unblock the
funnel. What is *not* at risk any more: no payer's limits move, no unhosted-wallet or cross-chain
capability is opened, and there is no tier to sweep and revoke later.

Mitigations: the decision is admin-only and never self-serve; the console shows the owner's tier and
provider beside every row, so a partner nobody verified is visible as one; the form must name the
person; and payout providers remain key-gated test mode.

## Turning it back on

Set `KYC_PROVIDER=persona` **and** both credentials, redeploy, confirm the `persona probe: key OK`
line. All three are required — credentials alone are no longer enough. The tier gate on
`/merchants/apply` re-imposes itself, `/kyc/verify` starts hosted inquiries again, the verification
card reappears on Home and Settings, and LP `/identity` stops redirecting. Partners approved while it
was off keep their approval — the business decision stands on its own; only the identity question
stays open.

## Why the payer app says nothing

The first version of this told the user: an "Identity checks are paused" card on Home and Settings, a
paragraph in the verify sheet, and a "We'll check this by hand" screen on the partner console. That
was removed on 2026-08-30. A payer can send, receive and scan-and-pay normally with the vendor off —
the gate lifts, the caps hold — so the notice explained an internal vendor state to someone it does
not affect, about a check they never asked for. The rule now: **`identityCheckAvailable === false`
renders nothing about identity, rather than a message about it.** `/apply` already worked this way;
the rest was brought into line.
