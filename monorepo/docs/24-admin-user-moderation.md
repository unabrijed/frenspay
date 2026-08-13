# 24 · Admin user moderation: renames, display names, suspension

**Decision (Bridge, 2026-08-13):** handles become **admin-mutable only** (support-request model — users still cannot self-change, onboarding's "can't be changed later" stays true for them); admin can set display names; admin can suspend/reinstate accounts; a freed handle **releases instantly** — anyone can claim it, saved QR codes follow the claimant. That last risk was weighed explicitly and accepted: "you have to manage your username."

## What was built

### Schema (migration 0009)

```sql
alter table users add column if not exists status text not null default 'active'
  constraint users_status_chk check (status in ('active','suspended'));
```

Mirrors `role` (0001) and `merchants.status`: text + check, default backfills.

### Enforcement: one choke point

`authPreHandler` (auth.ts) already fetches the user row on every authed request, so the suspension gate lives there and nowhere else: `status != 'active'` → **403 `{error:'account_suspended'}`**. Every route, current and future, is covered at once — including `/auth/sync`. Both auth paths share it (Privy and the dev `x-dev-user-id` fallback, which now fetches the row).

- **403, never 401** — clients sign out on `no_account`; a suspended user is signed in, just refused.
- **Admins are exempt.** The hook runs before `requireAdmin`, so a blanket 403 would lock a mistakenly-suspended admin out of the console that could fix it, defeating the ADMIN_EMAILS recovery bootstrap. Paired with the route guard that refuses to suspend admins in the first place.
- **Receives blocked at resolve**: `resolveHandleToFriend` gained `and status='active'` — a suspended handle stops resolving, so sends to it fail clean before money moves. `findUserByHandle` stays **unfiltered** (admin invite lookup and internal paths need to see everyone); `/transfer/prepare` re-checks status on the resolved recipient as the last stop (answered as `recipient_not_found`, so account state isn't probeable).
- **Merchant cascade**: suspending a user also suspends their merchant row. Routing reads `merchants.status` only (never joins users) and payouts advance via pollers/webhooks that bypass auth entirely — without the cascade a suspended LP keeps earning on NEW orders. One-way: reinstating the user does NOT resurrect the merchant (deliberate second decision via `/admin/merchants/:id/status`).

### Routes (admin.ts, both audited via `insertAdminAction`)

- `POST /admin/users/:id` `{handle?, displayName?, reason?}` — rename + display name. Handle runs the full sync pipeline (`canonicalHandle` → `screenHandle` → 23505→409 `handle_taken`). Two extra guards:
  - **409 `current_handle_denylisted`** — the denylist matches handle TEXT and gates money movement, so renaming a denylisted user would be a one-statement sanctions bypass. Resolve the entry first.
  - Denylist errors are honest here (`handle_denylisted`), unlike the public merge into `handle_taken` — operators are trusted; the merge only exists to stop outsiders probing the list.
  - Display names are sanitized (`sanitizeDisplayName`: strip control/format chars, collapse whitespace, ≤50) because display_name feeds the payee-confirm screen — the anti-wrong-send gate. Admin is currently its ONLY writer (sync never passes it; the upsert's ON CONFLICT no longer lists it, so no future sync caller can clobber a support edit).
  - Audit note carries `@old -> @new; reason` — after release/reclaim this is the only record disambiguating history.
- `POST /admin/users/:id/status` `{status, reason}` — **reason mandatory both ways.** Guards: 409 self-suspend, 409 suspending any effective admin (demote first).

### Clients

- **Admin console** (users page): status column, Edit dialog (handle/display name/reason), Suspend/Reinstate with reason. Server refusals surface in-dialog; the rules live server-side only.
- **Web**: 403 `account_suspended` is caught once at the API layer (`setAccountSuspendedHandler`, beside the session-revoked hook) → `SuspendedGate` paints a full-screen "Your account is paused" over every route — never the silent $0 dashboard the old error path produced. `/me` now rides along on `refresh()` (12s poll + focus): a renamed user's open tab regenerates its QR within one poll, and suspension/reinstatement reaches open tabs the same way (the flag self-clears on the next successful load/refresh).

## Deliberate cuts

Handle-history table (audit note suffices) · freed-handle reservation (Bridge's explicit call) · recipient-pinning race guard (client holds no recipient id — `Friend` is name/handle/ini; renames are rare admin support actions, the resolve→prepare window is seconds and not attacker-controllable; **revisit as mandatory if self-service handle changes ever ship**) · 'banned' third state · email notify · admin rate limiting · session revocation (no server sessions; the per-request row check IS revocation).

## Accepted limitations

- **Request-pay staleness**: paying a request resolves the payee handle at pay time from a live join; a rename between request creation and payment briefly points at the old handle (self-corrects within one 12s refresh). Upgrade path: bind request payment to `payment_requests.from_user_id`.
- In-flight money after suspension: signed transfers settle, deposits credit, in-flight orders complete (pollers/webhooks don't route through auth). The merchant cascade closes the only NEW-money path.
- Old notifications keep old handle text (baked at write — historical record).
- Suspended users lose read access too (support recovers via admin). Revisit if support burden appears.
- A suspended person can re-onboard with a fresh Privy account: suspension is account-level; person-level blocking is the denylist's job.

## Verification

`yarn typecheck` (all 5 workspaces) + `yarn check:all` green. Runtime: `check-admin.ts` §4 covers status default, receive-block + admin-path visibility, rename + instant re-claim, 23505 collision, sanitizer — run `yarn workspace @fpay/backend tsx scripts/check-admin.ts` after `yarn db:migrate` applies 0009 (shared stage DB — coordinate). Manual matrix: rename → audit row + QR refresh within 12s; suspend → paused screen, handle unresolvable, self/admin-suspend 409, merchant cascade; reinstate → app back, merchant stays suspended.

## Prism telemetry

```
- divergence: 0.54 (evidence 0.70, conclusion 0.30) | threshold 0.30 UNCALIBRATED
- models: draft=sonnet · skeptics=2x-opus+1x-sonnet per claim (cross-tier; version axis unavailable)
- claims: C1 grounded-with-corrections (admin exemption, dev-path fetch, error shape) ·
  C2 refuted→fixed (refresh()/me, filter placement; notifications snapshot accepted) ·
  C3 grounded (sync fence safe; denylist-rename guard added; sanitizer scope shrunk) ·
  C4 refuted→cut (guard unimplementable; request-pay window documented as accepted)
- grounding: 11/11 draft citations verified · fleet: 8 lenses + 12 skeptics + 1 grounding verifier
```

> Cross-tier verification reduces instance-/tier-level error correlation but not shared-lineage
> blind spots. Treat cross-tier survival as weaker evidence than grounding.

Verify-round changelog: killed the drafted `expectedRecipientId` race guard (the client literally lacks the data to use it), added the merchant-earnings cascade + suspended-admin exemption + denylist-rename guard, moved the receive filter off the shared lookup, and turned "no web work needed" into two small web fixes (central 403 hook, `/me` in refresh). Open risk not fully closed: request-pay staleness window (documented above, upgrade path named).
