# 07 · Admin and moderation

**Decision (Bridge, 2026-08-13):** handles are **admin-mutable only** (support-request model — users
still cannot self-change; onboarding's "can't be changed later" stays true for them); admin can set
display names; admin can suspend/reinstate accounts; a freed handle **releases instantly** — anyone
can claim it, saved QR codes follow the claimant. That risk was weighed explicitly and accepted:
"you have to manage your username."

## What it is

`users.role` (`user | merchant | admin`) gates the console; `users.status` (`active | suspended`)
gates the app. Both are plain columns with a CHECK constraint, both are enforced at one choke point
each, and both are written only through audited `/admin/*` routes — never client-editable. The
console itself is `apps/admin`, a separate Next.js app the backend treats like any other client: it
carries no special trust, it just happens to be the only caller who can pass `requireAdmin`.

## Roles model

- **Schema** (migration `0001_baseline.sql`): `users.role text not null default 'user' constraint
  users_role_chk check (role in ('user','merchant','admin'))`.
- **`user`** is everyone at signup. **`merchant`** is an informational mirror, not a capability —
  the real gate is `merchants.user_id` (`requireMerchant` in `auth.ts` reads that row, never
  `role`). The mirror is written once, at apply-time, in `insertMerchantApplication`
  (`apps/backend/src/db/queries.ts`): `update users set role = 'merchant' where id = $1 and role =
  'user'` — never demotes an existing admin.
- **`admin`** is granted two ways:
  - **Manual SQL** — the original (and still valid) path: `update users set role='admin' where
    handle='@you'`.
  - **`ADMIN_EMAILS` bootstrap** — `isRootAdminEmail(email)` in `auth.ts` checks a config list of
    emails; `effectiveRole()` treats a match as `'admin'` regardless of what the `role` column says.
    Every admin check in the codebase (`requireAdmin`, `GET /me`, the suspension gate) goes through
    `effectiveRole()` so the two answers can never disagree. This is deliberately a recovery
    mechanism: a bad demote, or a fresh environment with an empty `users` table, can never lock
    everyone out, because the env var still names someone who gets in.
  - **Console promote/demote** — `POST /admin/users/:id/role` (`{role: 'user'|'admin'}`), guarded:
    409 on self-demote, 409 demoting a root admin (`isRootAdminEmail`, since the row would lie about
    what's actually true). Demoting an admin who is *also* a merchant reverts them to `'merchant'`,
    not `'user'` — `setUserRole`'s `case` re-checks `merchants.user_id` at write time so the mirror
    stays accurate. Audited as `role_grant` / `role_revoke`.

## Console surface

`apps/admin` — every route calls `requireAdmin(req)` server-side first; the frontend renders a
denied state (`<Denied/>`) on a 403 rather than gating on anything client-held.

- **Read-only**: `/` (overview — order counts + everything needing a human: open disputes, stuck
  orders, risk flags, merchant alerts; 8s poll), `/orders/[id]` (full per-order record: events,
  routing attempts, dispute, escrow legs), `/merchants`, `/risk`, `/providers`, `/audit`
  (`admin_actions` trail), `/waitlist` (f-list signups, CSV export, no writes — the landing site is
  the only writer).
- **Users page** (`/users`, `apps/admin/src/app/users/page.tsx`) is where the write actions live:
  Edit (rename / display name / reason), Suspend / Reinstate (reason mandatory), Grant / Revoke
  admin. The page does not predict any server refusal — it fires the request and surfaces whatever
  the API says, so every rule (self-lockout, root-admin, denylist-rename) lives in exactly one
  place: the route.
- **Invites page** (`/invites`) — covered below.

## Flow — suspension enforcement (one choke point)

`authPreHandler` (`apps/backend/src/auth.ts`) already fetches the user row on every authed request
(Privy bearer path *and* the dev `x-dev-user-id` fallback), so the suspension gate lives there and
nowhere else: `status !== 'active'` → **403 `{error:'account_suspended'}`**. Every route, current and
future, is covered at once — including `/auth/sync`.

- **403, never 401** — clients sign out on `no_account`; a suspended user is signed in, just refused.
- **Admins are exempt** — `effectiveRole(user) !== 'admin'` is part of the gate condition itself, so
  a mistakenly-suspended admin still reaches the console that can fix it. Paired with a route guard
  that refuses to suspend an effective admin in the first place (`cannot_suspend_admin`, 409).
- **Receives blocked at resolve** — `resolveHandleToFriend` (`apps/backend/src/db/queries.ts`) adds
  `and status = 'active'` to its lookup: a suspended handle stops resolving, so sends to it fail
  clean before money moves. `findUserByHandle` stays **unfiltered** on purpose — admin lookups and
  internal paths need to see everyone, suspended or not. `/transfer/prepare` re-checks status on the
  resolved recipient as the last stop, answered as `recipient_not_found` so account state isn't
  probeable from outside.
- **Merchant cascade** — suspending a user also suspends their merchant row (`setMerchantStatus`,
  one-way: reinstating the user does **not** resurrect the merchant — that's a separate call to
  `POST /admin/merchants/:id/status`). Routing reads `merchants.status` only, never joining `users`,
  and payouts advance via pollers/webhooks that bypass auth entirely — without this cascade a
  suspended LP keeps earning on new orders.
- **Web** — the 403 is caught once at the API layer (`setAccountSuspendedHandler` in
  `apps/web/src/services/api.ts`, wired in `apps/web/src/services/privy/PrivyBridge.tsx`) and
  `SuspendedGate` (`apps/web/src/components/SuspendedGate.tsx`) paints a full-screen "paused" state
  over every route. `/me` rides along on the existing poll/focus refresh, so a rename or a
  suspend/reinstate reaches an already-open tab within one cycle.

## Routes (`apps/backend/src/routes/admin.ts`)

Every write below records an `insertAdminAction` audit row (`admin_user_id`, `action`,
`target_kind`, `target_id`, `note`) **before** responding.

- `POST /admin/users/:id` `{handle?, displayName?, reason?}` — rename + display name. Handle runs
  the full sync pipeline (`canonicalHandle` → `screenHandle` → `23505` → 409 `handle_taken`). Two
  extra guards: 409 `current_handle_denylisted` (renaming a denylisted user would detach them from
  their own denylist row — resolve the entry first); denylist errors are honest here
  (`handle_denylisted`, not the public `handle_taken` merge — operators are trusted, the merge only
  exists to stop outsiders probing the list). Display names go through `sanitizeDisplayName` (strip
  control/format chars, collapse whitespace, ≤50) because `display_name` feeds the payee-confirm
  screen; admin is currently its only writer.
- `POST /admin/users/:id/status` `{status, reason}` — **reason mandatory both ways.** Guards: 409
  self-suspend, 409 suspending an effective admin.
- `POST /admin/users/:id/role` `{role}` — see Roles model above.
- Plus the pre-existing surface: KYB approve/reject, merchant status, dispute resolve, denylist
  add/remove, payout-provider enable/priority — all audited the same way.

## Invite administration

**Schema** (migration `0007_invite_codes.sql`): `invite_codes` is real rows, not a counter. `code`
(PK, `'FP-XXXX-XXXX'`, Crockford base32 minus I/L/O/U, canonicalized by `canonicalInviteCode` in
`apps/backend/src/services/invites.ts`) is stored in **plain text** on purpose — the owner sees it
exactly once at signup (`users.invites_revealed_at` gates the reveal), but an operator has to be
able to read one back, so it isn't hashed. `owner_id` nullable: `null` is a **house code**, minted
from the console, belonging to nobody and constrained by nobody's allowance — the standing answer to
"we're out of invites." `redeemed_by` is `unique` (one code burns at most one account). `revoked_at`
is a soft mark, never a delete, so a revoked code can't be re-minted by chance and the audit trail
still points at something real. Status (`unused | burned | revoked`) is **derived**, never stored.

**Console** (`apps/admin/src/app/invites/page.tsx`, backed by `POST /admin/invites` and `DELETE
/admin/invites/:code`):

- **Mint** — `{count (1–50), ownerHandle?, note?}`. Blank `ownerHandle` mints house codes. The
  response carries the codes in clear — it's the only bulk view of them that exists, and minting
  exists to hand them to someone. Audited as `invite_mint` (`target_id` = `user:<handle>` or
  `'house'`).
- **Revoke** — unused codes only; a burned code created an account that still exists, so revoking it
  would make the audit trail lie. Audited as `invite_revoke` (`target_id` = the code).

⬜ **Decided 2026-08-13, not built:** remint the format from `FP-XXXX-XXXX` to `FREN-XXXX-XXXX`,
alongside a bulk-revoke of every outstanding `FP-` code and a reissue of 3 per user + fresh house
codes. Today's code still mints and validates `FP-` (`invites.ts` `PREFIX = 'FP'`); the migration
and reissue haven't landed.

## Soft-delete — ⬜ decided 2026-08-13, gap to close

**Decision:** delete is allowed anytime, even with a balance — funds are the user's own custody via
Privy (see [03-custody-money-in-and-confirmation](03-custody-money-in-and-confirmation.md)), never
the platform's, so there is no balance-based reason to block it. "Delete" means **app access
removed**, not fund seizure or account destruction: extend `users.status` with a `'deleted'` value
(or add a separate `deleted_at` column — mechanism TBD, not yet decided which) and route it through
the same enforcement the suspension gate already provides in `authPreHandler`.

**Ledger rows are retained — hard delete is not an option**, verified against the FK topology in
`apps/backend/src/db/migrations/0001_baseline.sql`:

| Behavior on `delete from users` | Columns |
|---|---|
| **RESTRICT** (no `on delete` clause → `NO ACTION`; the delete fails while rows reference it) | `transfers.from_user_id` / `to_user_id`, `payment_requests.from_user_id` / `to_user_id`, `admin_actions.admin_user_id`, `invite_codes.owner_id` / `redeemed_by`, `merchants.user_id`, `users.referred_by` |
| **CASCADE** (rows are silently destroyed) | `wallets.user_id`, `quotes.user_id`, `orders.user_id`, `risk_events.user_id`, `notifications.user_id` |

A hard delete on any user with transfer or invite history would fail outright; on a user with only
orders/quotes/risk history it would silently wipe the order and risk trail — audit-hostile either
way. Soft-delete is the only shape that survives this topology: nothing FK'd to `users` ever gets
touched, so `transfers`, `orders`, `risk_events`, and the rest stay exactly as they are today.

Consequences that follow from "app access removed, funds untouched":

- **Funds remain the user's directly via Privy** — the embedded wallet was always user-custodied,
  so deletion doesn't change custody, it just removes the app's ability to show or move the balance
  for them. Recovery copy explaining this (how to reach funds outside fpay) is still owed in web —
  not yet written.
- **Freed handle releases instantly**, same as a rename — Bridge's already-accepted risk, extended
  to delete without a new discussion.
- **"Ban" = suspend + a denylist entry**, not a third status. Suspend (`users.status='suspended'`)
  blocks the account; a `denylist` row (`kind='handle'` or `'address'`) blocks the *person* from
  re-onboarding under a new Privy identity. Deliberately two existing primitives composed, not a new
  enum value — `users.status` stays exactly `active | suspended` (+ the deletion mechanism above),
  never `banned`.

## Admin rows must never be hard-deleted

`admin_actions.admin_user_id references users(id)` carries no `on delete` clause (`0001_baseline.sql`)
— `NO ACTION`/RESTRICT, same as the table above. Since the audit trail is append-only and never
pruned, any admin who has ever performed a write has at least one `admin_actions` row naming them
forever, so deleting their `users` row will always fail the FK. The route comment in `admin.ts`
states this as the reason the role route only ever demotes: **demotion (`role_revoke`) is the sole
removal path for an admin — there is no delete.** This applies to the soft-delete decision above too:
an admin's own account, if ever soft-deleted, keeps its row (soft-delete never removes the row) so
the FK is never even tested — but if a *hard* delete were ever attempted on an admin, it would fail
loudly rather than orphan the audit trail.

## Deliberate cuts

Handle-history table (the audit note suffices) · freed-handle reservation (Bridge's explicit call) ·
recipient-pinning race guard on rename (the client holds no recipient id to pin — `Friend` is
name/handle/initial only; renames are rare admin actions and the resolve→prepare window is seconds
and not attacker-controllable; revisit as mandatory if self-service handle changes ever ship) ·
`'banned'` third status (composed from suspend + denylist instead) · email notify on
suspend/delete/rename · admin rate limiting · session revocation (no server sessions exist — the
per-request row check in `authPreHandler` **is** the revocation).

## Accepted limitations

- **Request-pay staleness** — paying a request resolves the payee handle at pay time from a live
  join; a rename between request creation and payment briefly points at the old handle (self-corrects
  within one refresh cycle). Upgrade path: bind request payment to `payment_requests.from_user_id`.
- **In-flight money after suspension** — signed transfers settle, deposits credit, in-flight orders
  complete (pollers/webhooks don't route through auth). The merchant cascade closes the only *new*-
  money path; nothing in-flight is clawed back.
- Old notifications keep old handle text (baked at write — historical record, not a bug).
- Suspended users lose read access too; support recovers via admin. Revisit if support burden appears.
- A suspended or (once shipped) deleted person can re-onboard with a fresh Privy identity —
  suspension/deletion is account-level; person-level blocking is the denylist's job.

## Legalities

Suspend and (planned) delete are both **access controls, not custody actions** — the platform never
holds keys or funds (see [01-architecture](01-architecture.md)), so neither operation touches money;
they only gate whether the app will act on a user's behalf. That framing is what keeps "delete with
a balance" and "ban" from being fund-seizure questions at all. Sanctions/denylist handling and the
KYC-tier interaction with account status are covered in
[08-compliance-and-legalities](08-compliance-and-legalities.md).

## Status

✅ Suspend/reinstate, rename/display-name edit, role grant/revoke, invite mint/revoke, and the full
audit trail are built, routed, and enforced at the single `authPreHandler` choke point. 🟡 Invite
code re-format (`FP-` → `FREN-`) is decided but not built. ⬜ Soft-delete is decided but not built —
no schema column, no route, no web recovery copy.

## Key files

- `apps/backend/src/auth.ts` — `authPreHandler`, `effectiveRole`, `isRootAdminEmail`, `requireAdmin`
- `apps/backend/src/routes/admin.ts` — every `/admin/*` route
- `apps/backend/src/db/queries.ts` — `setUserStatus`, `setUserRole`, `updateUserProfileAdmin`,
  `resolveHandleToFriend`, `findUserByHandle`, `mintInviteCodes`, `revokeInviteCode`,
  `listInviteCodesAdmin`, `insertAdminAction`
- `apps/backend/src/services/invites.ts` — code format, `canonicalInviteCode`, `mintCode`
- `apps/backend/src/db/migrations/{0001_baseline,0007_invite_codes,0009_user_moderation}.sql`
- `apps/admin/src/app/{users,invites,waitlist,page}.tsx`
- `apps/web/src/components/SuspendedGate.tsx` · `apps/web/src/services/api.ts` ·
  `apps/web/src/services/privy/PrivyBridge.tsx`
