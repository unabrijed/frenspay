# 07 · Admin and moderation

> **Monad prelaunch update (2026-10-01):** GET /admin/prelaunch provides authenticated aggregate campaign and receipt-backlog metrics. Campaign accounts and suspension are separate from legacy users; legacy admin user controls do not manage these accounts yet. See [24 — Monad prelaunch](24-monad-prelaunch.md).

**Decision (Bridge, 2026-08-13):** handles are **admin-mutable only** (support-request model — users
still cannot self-change; onboarding's "can't be changed later" stays true for them); admin can set
display names; admin can suspend/reinstate accounts; a freed handle **releases instantly** — anyone
can claim it, saved QR codes follow the claimant. That risk was weighed explicitly and accepted:
"you have to manage your username."

## What it is

**A person is always named twice** — `@handle` over email, one cell (`Who` in `components/ui.tsx`),
on every page that names one: dashboard, orders, risk, audit, and the partner's owner account on
Merchants. The email is how every login happens; the handle is the unique payment ID; an operator
cross-referencing a Privy session, a payer and a partner needs both on one line. `—` under a handle
means the email never synced (a Privy hiccup at signup, repaired on their next `/me`) or the row is
deleted. Inputs that name someone ELSE (rename, denylist) are trimmed and then **rejected** by the
server if not canonical — never repaired: `@ne-ha` quietly becoming `@neha` is a different person.
A denylist handle is stored canonical (`@` + lowercase), the form `screenHandle` matches on.

`users.role` (`user | merchant | admin`) gates the console; `users.status` (`active | suspended | deleted`)
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
  orders, risk flags, merchant alerts; 8s poll; the orders list with the search below), `/orders/[id]`
  (the full record of one payment, §The record below), `/transactions` (the money ledger across
  every user, §The ledger below), `/merchants`, `/risk`, `/providers`, `/audit` (`admin_actions`
  trail), `/waitlist` (f-list signups, CSV export, no writes — the landing site is the only writer).
- **Users page** (`/users`, `apps/admin/src/app/users/page.tsx`) is where the write actions live:
  Edit (rename / display name / reason), Suspend / Reinstate (reason mandatory), Grant / Revoke
  admin. The page does not predict any server refusal — it fires the request and surfaces whatever
  the API says, so every rule (self-lockout, root-admin, denylist-rename) lives in exactly one
  place: the route.
- **Invites page** (`/invites`) — covered below.

## Flow — suspension enforcement (one choke point)

`authPreHandler` (`apps/backend/src/auth.ts`) already fetches the user row on every authed request
(Privy bearer path *and* the dev `x-dev-user-id` fallback), so the suspension gate lives there and
nowhere else: `status !== 'active'` → **403** — `{error:'account_deleted'}` when the row is deleted, otherwise
`{error:'account_suspended'}`. Two codes, not one.. Every route, current and
future, is covered at once — including `/auth/sync`.

- **403, never 401** — clients forget the account on `no_account` (never the session — [18](18-sessions-and-boot.md)); a suspended user is signed in, just refused.
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
- `POST /admin/users/:id/status` `{status, reason}` — three statuses (`active | suspended | deleted`),
  **reason mandatory in every direction.** Guards: 409 self-suspend, 409 self-delete, 409 suspending
  an effective admin, 409 deleting one.
- `POST /admin/users/:id/role` `{role}` — see Roles model above.
- Plus the pre-existing surface: KYB (**four** decisions — approve · reject · ask for more · claim for
  review, detailed below), merchant status, dispute resolve, denylist
  add/remove, payout-provider enable/priority — all audited the same way.

### The status write, and what it may no longer do

`POST /admin/merchants/:id/status` used to be the one unguarded write on this page: no reason, no
state check, and it could set a partner straight to `online`, bypassing the KYB-approved + bond-floor
conditions the partner's own switch enforces. Since 2026-08-30 it accepts only `suspended` and
`offline` — an admin can pull a partner out, or hand a suspended one back to *offline*; **only the
partner's own switch writes `online`**, and it is the one that enforces KYB + bond. A partner who has
**left** (`suspend_reason = 'exited'`) is frozen by a database trigger against every status writer,
this one included; the route answers `409 merchant_exited` and the console shows "exited" with no
Reinstate. It still takes no reason — that asymmetry with the other writes stands.

### The stake waiver (0028)

Since 2026-09-05 a **root** admin (`isRootAdminEmail`, never the console-grantable `admin` role) may
let one partner work before staking: `POST /admin/merchants/:id/stake-waiver` with a typed reason,
`DELETE` to end it. It sets `merchants.bond_waived_until` 30 days out (`WAIVER_DAYS`) and nothing else.
While live the partner counts as holding exactly the floor in every bond gate (the routing SELECT, the
online switch, the reinstate mirror, `lockOrder`, and `bondCap` in the float math): they may go online
and carry `MIN_BOND` in flight, flat, at any tier. The first upheld dispute clears it in the statement
that draws the bond; granting it and the bond auto-reinstate both require the owner to be an active
user, so a blocked account cannot come back through it. `admin_actions` records `stake_waive` (with
`until=` and the reason) and `stake_waiver_end`. The partner is never told: `GET /me` reports the
floor as 0 and the console walks them to "You're ready". On the Partners page it is the Waive stake /
End waiver button on an approved row and a `waived to <date>` badge in the Bond cell. The two tabs
are labelled Partners and Payout providers: the first is the people who settle payouts, the second the
per-corridor disbursement ladder ([06](06-offramp-and-settlement.md)). Decision record: [21](21-stake-waiver.md).

### Stake withdrawals

A partner's withdrawal (or exit) debits their bond immediately and waits for a human. The console
lists what is owed — who, how much, the wallet it goes to (the address the partner named when they
asked, else their fpay wallet — [20](20-stake-claims.md)) — and one action, **Record as sent**: a **root** admin moves the USDC from the cold stake treasury by
hand and records the transaction signature here. Record-only, root-only (`requireAdmin` is flat, and
a route that stands in for a money movement must not inherit every console-granted admin), one
signature good for one release (unique), and an `admin_actions` row. Docs/15 has the reasoning.

### Stake deposits to check

The other direction ([20](20-stake-claims.md)). A partner pays the stake treasury from wherever their
USDC is and pastes the signature; the server reads what that transaction moved off the chain. The
console lists every open claim — who says it is theirs, the amount **as read from the chain**, the
sender, when it landed, a Solscan link, and **"also claimed by @x"** when another partner pasted the
same signature (the treasury address is public; the first to paste is not necessarily the one who paid).
Two verbs, any console admin: **Credit** attributes the deposit — the server inserts a pending
`transfers` row and the confirmer's chain check lands the bond, so nobody types a number into a bond;
**Reject** takes the reason the partner reads and frees the signature for whoever actually paid. Both
write `admin_actions`.
## The record, the ledger and the search (2026-09-05, [22](22-admin-ledger.md))

Bridge: "our admin section should also keep track of all transactions, amounts, conversions and
everything as there can be disputes as well later." The finding was that the database already
kept all of it and the app never rewrites it; the console threw it away. So the console shows it.

### The record

`/orders/[id]` reads, in the order a dispute call needs it: the fiat amount and currency, the
USDC, the payee's printed name, where it was paid (destination, rail, the VPA's operator), the UTR
and when it was claimed, when the window ends (null on an order under review reads "frozen by
dispute": the escrow is held, the clock has not lapsed), the lock, the partner's real name (the
payer's DTO masks it as "Best route"; the admin mapper used to inherit the mask), the reference,
created / updated, and then what the price was struck on: the all-in rate, the mid at strike
(`quotes.mid_rate`, 0029; a set mid with no fetch time priced off the fallback rate; none at all
predates 0029), the spread and the platform fee. The last three are admin-only fields on
`AdminOrder`; the payer's `Quote` still carries the all-in rate and nothing behind it.

A payment made in parts lists its parts. The transfers table shows every transfer that ever
touched the payment: the escrow pointers of the order and its legs, plus the rows a retry left
behind, which only a `settle_dropped` event names (`settleEscrow` writes one for ANY non-confirmed
prior at the moment it moves the pointer). Amount, from / to, order reference, timestamps, a
Solscan link. The dispute card names who resolved it, the note, and the bond drawn (penalty rows
only; "-" when the bond was already empty).

**A resolution needs a reason.** `POST /admin/disputes/:id/resolve` answers 400 `note_required`
without one, before the settle (which moves money). The console asks for it the way a KYB decision
asks (`window.prompt` inside the confirm; cancel decides nothing). The note lives in
`admin_actions` and is read by the console only: never the partner, never the payer.

### The ledger

`/transactions` (`GET /admin/transfers`, keyset-paged) is `transfers` across every user: sends,
top-ups, escrow legs, stake credits, bridge legs. Each side is a handle when it is an fpay account
and an address always; an escrow leg names its order (the fund row through the primary only, since
one fund row funds every leg); a bridge leg carries the far side's state. Orders were never all
transactions: a plain send appeared in no admin surface before this page.

### The search

One input, on `/transactions` and inline in the orders list on `/`: `@handle`, email, an id, a
signature or a reference, decided by shape and bound as a parameter in every branch
(`searchShape`, `queries.ts`). Exact only, so every branch hits a unique index, and a payee's VPA
is never a key (a VPA-to-person oracle). Garbage after an `@` matches nothing rather than 400ing.
A search by handle is a person's statement. **It is the one admin read that is audited:**
`ledger_search` with the query's shape (handle / email / id / signature / reference), never its
value, first page only; the overview stops polling while a search is set so a tick cannot write a
row.

### What the bulk list never carries

`GET /admin/orders` used to return every payee's destination and printed name on every row, at up
to 100 a page, and nothing rendered them. `orderSelect(false)` emits both as `null::text` under the
same aliases for the list; the single-order read and every payer read keep them. In SQL, never in
a mapper, never by a duplicate output column. `check-admin` asserts it.

### The seed script

`db:seed` is a wipe, and local dev points at the stage database. It now asserts the database tier
and refuses any database that holds a `transfers` row, no bypass: `db:reset` (which refuses
production) then `db:init` then `db:seed` is the fresh-database path.

### Deliberately not built

CSV export (a written external request un-defers it: root-only, audited, page-capped) · evidence
upload (the first dispute a screenshot decides) · a per-user statement page (the ledger search by
handle is that) · a nav-global search · admin read rate limits and tiered roles (more than a
handful of admins) · a per-partner bond ledger page (the merchants list shows the 90-day upheld
count beside the rate) · a note field on the confirm dialog (the prompt is the console's pattern).

## Invite administration

**Schema** (migration `0007_invite_codes.sql`): `invite_codes` is real rows, not a counter. `code`
(PK, `'FREN-XXXXXXXX'`, Crockford base32 minus I/L/O/U, canonicalized by `canonicalInviteCode` in
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

✅ **Shipped 2026-08-13 (cutover pending):** the mint prefix is `FREN-` and
`scripts/remint-invites.ts` (Bridge-run, rerun-safe: the revoke filters `code like 'FP-%'`)
performs the one-shot cutover — reminting from `FP-XXXX-XXXX` to `FREN-XXXX-XXXX`,
alongside a bulk-revoke of every outstanding `FP-` code and a reissue of 3 per user + fresh house
codes. **The cutover landed on 2026-08-13**: `invites.ts` has `PREFIX = 'FREN'`, every outstanding `FP-`
code was bulk-revoked and 3 per user reminted. This section said otherwise until 2026-08-29.

## Soft-delete — ✅ shipped 2026-08-13 (🟡 until migration 0012 applies on stage)

**Decision:** delete is allowed anytime, even with a balance — funds are the user's own custody via
Privy (see [03-custody-money-in-and-confirmation](03-custody-money-in-and-confirmation.md)), never
the platform's, so there is no balance-based reason to block it. "Delete" means **app access
removed**, not fund seizure or account destruction. **Decided and shipped** (migration 0012): a third
`users.status` value, `'deleted'`, not a separate `deleted_at` column — routed through the same
enforcement the suspension gate already provides in `authPreHandler`, which answers
`account_deleted` rather than `account_suspended` for it.

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
  enum value — `users.status` stays exactly `active | suspended | deleted` (0012 settled the
  mechanism), never `banned`.

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

## KYB review — four replies, and a reason that is read

A business check used to be a boolean an admin flipped, with no evidence collected and no reason
recorded. It is now four decisions from `POST /admin/merchants/:id/kyb`:

- **approve** — the only one that needs no note. Lands the merchant on *offline*, never online:
  approved means eligible to work, not at the desk. They say when.
- **more_info** — the one that matters. It hands the ball back and lets them resubmit. Without it a
  reviewer's only replies are yes and no, and "no, and I won't say why" is how you lose an LP who
  mistyped their PAN.
- **review** — a claim, not a verdict, so a second reviewer sees someone is already on it.
- **reject** — terminal.

**A note is required on everything except an approval, and the merchant reads it verbatim.** That is
the whole improvement: a status word with nothing behind it is not a decision anyone can act on.
Every decision appends to `merchant_kyb_events`, which is what the merchant's own timeline renders,
*and* writes the usual `admin_actions` row. Only `submitted`/`under_review`/`more_info` are
decidable — there is nothing to judge before a submission exists, and reopening a terminal is a
separate deliberate act.

**Stake-withdrawal release has a surface now** (§Stake withdrawals above; it was manual SQL until
2026-08-31). Sending the USDC is still a human action, on purpose: automating it needs a signer for the
stake treasury, which deliberately has none ([11](11-lp-console.md) § The stake).

**Re-check after an edit (2026-09-03, [14](14-manual-onboarding-fallback.md) §Editing).** An approved
partner who changes one of the account fields comes back to this queue as `submitted` and offline,
with a **"re-check: <field>"** badge beside the status naming what changed (`AdminMerchant.kybRecheck`,
from the latest `kyb_edited_recheck` event — keys only). Approve re-admits them, still offline; they
flip online themselves. Edits to anything else never appear here; they save in place.

## Status

✅ Suspend/reinstate, rename/display-name edit, role grant/revoke, invite mint/revoke, and the full
audit trail are built, routed, and enforced at the single `authPreHandler` choke point.
✅ Soft-delete (2026-08-13): migration 0012 + `deleteUser` handle-release + the route's third state
+ distinct `account_deleted` web screen + console Delete action + check-admin §5 — 🟡 until
`db:migrate` applies 0012 on stage. ✅ FREN re-format shipped in code; 🟡 the one-shot
`remint-invites.ts` cutover awaits its Bridge-run.

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
