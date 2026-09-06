# 21 · The stake waiver: one partner, before staking, on the record

_2026-09-05. Prism-plan: six lenses, one grounding verifier, three skeptics; converged after one
verify round. Companion to [07](07-admin-and-moderation.md) §The stake waiver, [11](11-lp-console.md)
§The stake, [15](15-pilot-escrow-and-bond.md), [20](20-stake-claims.md)._

## The problem

Bridge approved a partner in the admin console and the partner still could not take an order. Not a
bug: the $100 stake floor (`MIN_BOND`) is enforced in eight independent readers by design, and
approval never touched any of them. There was no bypass of any kind; the only exemption anywhere was
the platform's own `psp` settlement rows. For the first partners and for testing, Bridge wanted an
admin-only allowance, strictly constrained, that the partner never sees.

| bond reader | where |
|---|---|
| routing SELECT | `queries.ts` `listRoutableMerchants` |
| the partner's own online switch | `queries.ts` `setMerchantOnlineSelf` |
| auto-suspend / reinstate tick | `merchantStats.ts`, `queries.ts` `reinstateBondSuspendedMerchant` |
| order lock capacity | `queries.ts` `lockOrder` (found by the adversary lens; the first draft missed it) |
| routing float | `routing.ts` `availableOf` |
| the partner's work-list headroom | `merchantOps.ts` `listWork` (found by a skeptic) |
| `GET /me` floor and max float | `routes/merchant.ts` `toMerchantProfile` |
| admin status route refuses `online` | `routes/admin.ts` |

## What was decided

A per-partner waiver, `merchants.bond_waived_until` (0028):

- **Root admin only** (`isRootAdminEmail`). The closest analogue by blast radius is releasing a stake
  withdrawal, root-only because a route that stands in for money movement must not inherit the
  console-grantable `admin` role. A typed reason is required and is the audit's only WHY.
- **Worth exactly the floor, flat.** Below the floor a live waiver counts as `MIN_BOND` in every gate
  and in `bondCap`; it is never multiplied by tier leverage, so a waived partner at any tier carries
  at most what a floor-bonded tier-1 partner would. At or above the floor the waiver is moot.
- **30 days** (`WAIVER_DAYS`), re-grant to extend. The first **upheld dispute** clears it in the
  statement that draws the bond: with no bond to draw, that is the stop-loss.
- **Never resurrects a banned user.** The user-block cascade skips a row already suspended for bond,
  leaving `suspend_reason = 'bond'` in place; the grant and the reinstate mirror both require the
  owner to be an active user. That also closes the same pre-existing gap for a bond top-up.
- **The partner is never told.** `GET /me` reports the floor as 0; the console walks them to
  "You're ready"; four strings that would have read "$0.00" or "by your stake" are conditional.
- **Audited**: `admin_actions` `stake_waive` (`until=<iso>: <reason>`) and `stake_waiver_end`.
  Nothing is written to the partner-visible `merchant_kyb_events`.

`check-routing-math.ts` asserts that all four SQL gates carry `bond_waived_until > now()`, so no gate
can drift open or shut alone.

## What was rejected, and its strongest case

- **Blanket: approval alone lifts the floor.** Zero friction, no column. Rejected: it makes `MIN_BOND`
  dead code for everyone, cannot be ended per partner, and contradicts "only on strict constraint".
  The Waive stake button appears on a row the moment it is approved, so friction is one click.
- **House bond: the platform posts a $100 ledger `adjust`.** No gate edits, perfect secrecy. Rejected:
  `requestStakeWithdrawal` gates only on `bond_usdc >= amount`, so the phantom $100 is withdrawable as
  real treasury USDC, and `bond_usdc = Σ ledger = treasury` becomes false, the one thing counsel cannot
  be shown. The codebase already rejects it by name.
- **Admin writes `status = 'online'`.** Invariant 40; the tick would suspend it within a pass.

## Records this leaves

- [08](08-compliance-and-legalities.md): "every routable partner is bonded" is true except where
  `admin_actions` says otherwise. [15](15-pilot-escrow-and-bond.md): the list of live waivers should
  be empty before any third party is on a leg. Project-model invariant 62.
- This deliberately re-opens, per partner and on the record, the "zero-stake LP routable for 80 s"
  bug fixed in invariant 16.

## Also shipped alongside

- Admin tabs relabelled **Partners** (the people who settle payouts) and **Payout providers** (the
  per-corridor disbursement ladder). Same routes.
- The console is installable to the home screen: `app/manifest.ts`, `appleWebApp` metadata,
  192/512 icons from `yarn brand`, and an Account row leading to `/account/install` (iOS share-sheet
  line, Android `beforeinstallprompt` button, menu fallback), hidden once standalone. No service
  worker: Chrome no longer needs one, and offline is not a promise a payout console can make.

## Verification record

- Grounded: every anchor re-opened by the verifier; Next 15.5.19 `MetadataRoute.Manifest` and
  `appleWebApp` types; Chrome install criteria (192 + 512 icons, no service worker). Struck: "iOS
  honours manifest `display: standalone`" had no source; iOS rests on the meta, verified on device.
- Skeptics (2× opus + 1× sonnet, refute by default) broke parts of all four load-bearing claims:
  `greatest()` leaked leverage on partial bonds (fixed with the flat-floor `case`); `listWork` was
  missing from the reader set; a blocked owner could come back through the reinstate mirror; two more
  partner strings leaked. All four absorbed. Cross-tier survived: `drawDownBond` has one caller;
  `claimOrderPayout` has no bond predicate so in-flight orders continue; human suspensions are never
  reversed; no other check script pins text the edits touch.
- Open: reroute (`reassignOrderMerchant`) has no capacity predicate; paid exposure is still bounded by
  the lock CAS. Pre-existing for staked partners too. The status flip on expiry lags up to two stats
  passes while SQL already excludes the partner.

> Cross-tier verification reduces instance-/tier-level error correlation but not shared-lineage
> blind spots. Treat cross-tier survival as weaker evidence than grounding.

## Telemetry
- divergence: 0.64 (evidence 0.80, conclusion 0.40) | threshold 0.30 UNCALIBRATED
- models: draft=fable · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: lock-fifth-gate grounded (≤$100 half corrected) · reader-set-complete corrected · reinstate-safe corrected · no-partner-tell corrected · drawDownBond-single-caller cross-tier-survived · claim-has-no-bond-gate cross-tier-survived
- fleet: 6 lenses + 1 grounding verifier + 3 skeptics
