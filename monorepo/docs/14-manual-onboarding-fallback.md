# 14 · Onboarding when the identity vendor is off

> **Shipped 2026-08-29.** This documents an *accepted risk*, not a design we are proud of. It exists
> because the identity vendor has no production key yet and the partner funnel was shut, not slowed.
> Read §The accepted risk before extending anything here.

## The problem

Persona gates tier 2. Tier 2 gates `/merchants/apply`. Persona has no production key until its
compliance review clears (§Getting a production key in [10-ops-and-roadmap](10-ops-and-roadmap.md)),
so **nobody could become a partner at all** — the LP marketplace, the whole subject of
[11-lp-console](11-lp-console.md), had no way to admit its first human.

Blanking the credential in Railway was the intended way to say "the vendor is off". It wasn't:
`assertKycConfig` threw, `server.ts` exits 1 on any boot throw, and the deploy crash-looped.

## The switch

`config.personaLive` (`apps/backend/src/envConfig.ts`) is the single source of truth:

```
personaLive = KYC_PROVIDER is 'persona'  AND  the API key is real  AND  the template id is real
```

"Real" is `usableSecret` — non-empty and not placeholder-shaped (`<your key>` counts as absent). So
**blanking either variable turns the vendor off**, and the tier-prefix rule (`STAGE_` on stage, bare
names on prod) stays the only thing to get right. `KYC_PROVIDER=""` does *not* work as a switch:
`env()` collapses an empty value to its fallback, which is `'persona'` on both deployed tiers.

What each side of the switch does:

| | vendor on | vendor off |
|---|---|---|
| `POST /kyc/verify` | starts a hosted inquiry | `503 kyc_unavailable`, before any network call |
| KYC reconciler | polls every 15s | stands down (no sessions are ever created) |
| boot probe | one `persona probe:` line | silent |
| `POST /merchants/apply` | requires tier 2 | no tier gate |
| KYB approval | approves a business | approves a business **and grants the owner tier 2** |
| `/me.identityCheckAvailable` | `true` | `false` |

`assertKycConfig` still refuses to boot for exactly one configuration: a `persona_sandbox_…` key on a
production tier. A sandbox key never sees a real document, so booting prod with one would hand out
tier 2 for test data — worse than not booting.

Seven scenarios are asserted in `apps/backend/scripts/check-kyc-switch.ts` (`yarn check:kyc`, in
`check:all`). It spawns a process per case because `envConfig` reads `process.env` once at load; the
whole failure mode is env-shaped and invisible to `tsc`.

## What replaces the vendor

**Nothing new.** The partner application already collects a 13-field business form
(`packages/shared/src/kyb.ts`), a human already reads it in a queue that already exists
(`/admin/merchants`), and that review already has four outcomes, a mandatory applicant-visible note,
an append-only timeline and an audit row. The form is modelled on what peer platforms ask before
letting anyone in — the screening block is close to field-for-field with p2p.me's merchant form.

Two things were added to make it carry an identity decision:

- **`KybField.identity`** marks the one required field naming the *person* rather than the business.
  India has PAN. Indonesia gained NIK (the 16 digits on the KTP) — NIB and NPWP are both about the
  business. `check-kyb` asserts exactly one required identity field per country, so a new corridor
  cannot ship without one.
- **`contactTelegram`**, optional. `/merchants/apply` already refuses without a contact number, so
  nobody is unreachable; this is here because with the vendor off the review becomes a conversation,
  and that is the channel these conversations actually happen on.

**No documents are collected.** Nothing in this repo stores files, deliberately
(`0016_merchant_kyb.sql`), and that has not changed. The reviewer asks for whatever they need over
the contact channel. This is honest about what it is: a human judging typed identifiers and a stated
intent, not document verification.

## The grant

`POST /admin/merchants/:id/kyb` with `approve`, while `personaLive` is false, additionally:

- `setKycApproved(ownerUserId, 2, 'manual')` — `greatest(kyc_tier, 2)`, so a re-approval can never
  *lower* a tier, and it stamps `kyc_status` + `kyc_verified_at`. Never `setUserKycTier`, which is a
  plain assignment and would leave the row in the reconciler's pending pool forever.
- `kyc_provider = 'manual'` — the provenance marker. **`select id from users where kyc_provider =
  'manual'` is the re-verification list** when the vendor comes back.
- `notifyKycUpgraded` — the only producer of the `kyc_upgraded` notification.
- an `admin_actions` note that says a *tier* was granted, not just that a business was approved.

Platform `psp` rows have no `user_id` and are skipped (invariant 14).

The console shows the owner's tier and who decided it next to every row, and the Approve dialog says
out loud that it is about to raise that person's own payment limits. The submitted evidence stays
visible after a decision — "what did we approve this person on?" outlives the queue.

## The accepted risk

This **conflicts with the standing rule in [08-compliance-and-legalities](08-compliance-and-legalities.md)**
that no real payout happens before a real KYC/AML vendor. It was taken knowingly, by Bridge, on
2026-08-29, to unblock the funnel.

Tier 2 is one number doing two jobs, and only the first was wanted:

1. `cashOut: true` — the partner funnel. This is the goal.
2. It raises that person's **own payer limits** to $1,000/tx and $5,000/day on mainnet, up from
   $100/$300. This rides along.

Mitigations in place: the grant is admin-only and never self-serve; every such user is stamped
`manual`; the audit row records who granted it and when. Payout providers remain key-gated test mode,
so no real fiat leaves through this door yet.

**Owed work, in order:**

1. When Persona goes live, sweep `kyc_provider = 'manual'` and re-verify. Nothing does this
   automatically, and nothing will notice if it never happens.
2. If exposure #2 needs closing before then, the cheap version is a fourth `KYC_TIERS` row —
   `cashOut: true` with tier-1 send limits — rather than a new gate at every call site.

## Turning it back on

Set both credentials, redeploy, confirm the `persona probe: key OK` line. The tier gate on
`/merchants/apply` re-imposes itself and the console stops granting tiers — both read the same
boolean, nothing else changes, and no already-granted tier is touched.
