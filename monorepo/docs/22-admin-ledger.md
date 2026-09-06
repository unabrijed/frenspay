# Admin keeps a track of everything (transactions, amounts, conversions) for disputes

> **Status (2026-09-05):** the decision record of the prism plan Bridge approved, shipped the same day
> as four commits on `stage` once the stake-waiver session had committed the files it held: the record
> on the order page and every settlement leg reachable; 0029 + the `mid_rate` writer, the required
> note, the seed guard; the Transactions page and the search; the list redaction, the upheld count and
> the docs (07 §The record, the ledger and the search is the shipped description). Found and fixed on
> the way: the admin order mapper inherited the payer's "Best route" mask, and the send note was
> unbounded. Bridge runs 0029 on stage, then `check:admin` and `check:fees` by hand.

Prism plan, 2026-09-05. Mode: looped (plan/decision), 1 critique round, converged. Fleet: 8 lenses
(money + data = high-stakes): first-principles · adversary · practitioner · security · regulatory ·
data-integrity · simplicity · UX/operator-flow. DIVERGENCE 0.74 (evidence 0.78, conclusion 0.68) |
threshold 0.30 UNCALIBRATED.

## Context

Bridge: "our admin section should also keep track of all transactions, amounts, conversions and
everything as there can be disputes as well later, so we need a track of everything here."

The console today (`apps/admin`) shows an orders list (handle, partner, USDC, state), an order page
(timeline, routing, dispute with resolve buttons, transfers as kind/signature/status), risk events,
the admin audit trail, users, merchants, providers, invites, denylist, waitlist. An operator on a
dispute call cannot see the fiat amount, the rate, the spread, the fee, the payee, the UTR, or any
transfer amount on the order page. There is no cross-user transfers ledger, no search, no per-user
statement, no list of resolved disputes, no export. Plain sends, adds and bridge transfers appear in
no admin surface at all.

## 1. Recommendation

Do not build a tracking system. The ledger already exists and the app never rewrites it. Ship four
small commits on `stage`, in this order:

1. **Show the record the admin already receives.** The order page renders payee + UTR + the
   window first, then the money (fiat, USDC, all-in rate, mid, spread, fee), sibling legs of a
   split, every transfer that ever touched the order or its legs (amount, timestamps, note,
   including dropped, failed and refund legs), and on the dispute: who resolved it, the note, the
   bond drawn. Plus one restructured branch in the settle path so any orphaned settlement row is
   named by an event. No migration.
2. **Capture what is otherwise lost, and stop the one thing that can erase it.** `quotes.mid_rate`
   + `mid_rate_as_of` at strike (one migration, Bridge-run); a required note on dispute resolve
   (the route already stores it; the console never sends one); a guard on the seed script, which
   today deletes every ledger table with no tier check while local dev points at the stage DB.
3. **A Transactions page over `transfers`** (the literal "all transactions": sends, adds, escrow
   fund/release, stake credits, bridge legs), keyset-paged, with one exact-match search `q`
   (reference code, @handle, email, signature, id) shared with the orders list, audited by shape
   when used. Search by handle is the per-user statement.
4. **Redact payee VPA + name from the bulk orders list in SQL** (the single-order read keeps them),
   an upheld-dispute count per partner on the merchants page, and the docs: 07 console surface, 09
   the two columns, 08 a retention placeholder, 05 one line, plus the prism decision doc + memory.

Deliberately not built: CSV export, evidence upload, a separate per-user statement page, a global
search box in the nav, admin read rate limits, tiered admin roles, a transfers row for the fee leg,
append-only triggers, an LP-typed "paid amount" on the paid step, a per-partner bond ledger page, a
`Confirm` dialog with a text input (the console's existing prompt pattern is reused instead).
Triggers to un-defer each are in §5.

## 2. Why

- **The app never rewrites money.** `quotes` has no UPDATE statement anywhere in `apps/backend`
  (`insertQuote`, `queries.ts:1433`, is the only writer). `updateOrder` (`queries.ts:1787-1830`)
  whitelists seven non-money fields. `payout_utr` is write-once behind `payout_claimed_at is null`
  (`queries.ts:3392`); `merchant_id` cannot change after a claim (`lockOrder` `:3098`,
  `reassignOrderMerchant` `:2200`); transfer signature and status are one-way (`queries.ts:1086,
  1093, 1110`). `reconcileBridgeAmount` (`queries.ts:4493-4506`), the only ungated amount rewrite,
  has zero callers. **The exception is not the app:** `db/seed.ts:37-48, 91-92` deletes
  notifications, risk_events, denylist, disputes, routing attempts, order_events, orders, quotes,
  non-psp merchants, payment_requests and transfers, unconditionally, against whatever
  `DATABASE_URL` says, and local dev points at stage. The delete order means it errors part-way on
  `merchant_bond_events.transfer_id` (0024:31) and leaves a half-wiped database.
- **The console throws the record away.** `AdminOrder extends Order` (`contracts.ts:850`) and
  `ORDER_SELECT` (`queries.ts:1580-1594`) already return `quote.rate`, `quote.currency`, `amountFiat`,
  `quote.payoutDestination`, `quote.payoutName`, `payoutUtr`, `payoutClaimedAt`, and `toOrder`
  strips nothing but the partner name; the page (`apps/admin/src/app/orders/[id]/page.tsx`)
  renders none of the seven. `listOrderTransfersAdmin` (`queries.ts:4606-4620`) selects `id, kind,
  status, signature` from rows that also hold `amount_usdc, created_at, confirmed_at, from_address,
  to_address, note`, and joins one order id, so a split's leg releases are invisible from the primary.
- **Two values are lost at write time.** The mid-market rate is read into a local at
  `quoteEngine.ts:48` and discarded; `queries.ts:1442-1444` says so in its own comment. It is
  recoverable from `rate + spread_bps + platform_fee_usdc` only when `lpRate² / amountFiat < 100`
  (the inversion interval is `1e-6 · lpRate² / amountFiat` against a 1e-4 rate grid): exact for
  INR at normal sizes, five candidate mids for a 500,000 IDR order (skeptic brute force). The FX
  source is a "latest" endpoint with no history (`fxRate.ts:52-66`). The dispute reason is lost
  because the console calls `resolveDispute` without a note (`page.tsx:53-72`) although
  `routes/admin.ts:445-451` stores one.
- **Settlement rows can be orphaned from the order.** `settleEscrow` (`orderMachine.ts:458-478`)
  names a stale pending release in a `settle_dropped` event before overwriting the pointer, but a
  row that fails on-chain (`:477`) or that the confirmer fails on a parse contradiction (invariant
  33) is `'failed'` when the retry runs, matches neither branch at `:466-467`, and is overwritten
  at `:475` with no event. The admin join on the pointers then shows the last leg only.
- **The bulk list leaks what the page never shows.** `ADMIN_ORDER_SELECT` wraps `ORDER_SELECT`, so
  `GET /admin/orders` returns `payout_destination` + `payout_name` for every row at up to 100 per
  page; nothing in `apps/admin/src` reads either (grep negative, three independent readers).
  `listOpenOffers` (`queries.ts:3547`) already shows the pattern: `null::text` in SQL, never in a
  mapper (invariant 19). `Quote.payoutDestination` is optional and `toOrder` does `?? undefined`.
- **A quote struck off the fallback rate would crash the write as first drafted.** `formatAmount`
  throws when a value carries more decimals than asked (`lib/units.ts:77-83`); live rates are 4dp
  (`fxRate.ts:31`) but the fallback is `config.fxFallbackRates[ccy]` verbatim (`fxRate.ts:37`),
  operator text with unbounded decimals. Rounding the fallback at the source fixes both the write
  and makes the stored mid equal what pricing consumed.

## 3. Steelman of the rejected options

**"Render only; skip the migration, the mid is recoverable."** Strongest case: Bridge runs every
migration by hand on the shared stage DB, the recovery arithmetic is exact for INR (the only live
corridor), and a column nobody reads is the kind of scaffolding this repo cuts. Why it still loses:
the loss is irreversible and the cost is two columns and two lines; IDR is coded and every
low-decimal rail after it has the same problem; the FX source has no history; and a derived value
must be re-derived by a person under dispute using a formula that can change. A stored number is
evidence, a derived one is an argument.

**"Build the full thing: transactions, statements, export, evidence, resolver columns."** Strongest
case: Bridge said "everything", and a regulator's request arrives as "send me a file". Why it still
loses: evidence upload is a product (blob store, moderation, a channel from an operator to a
counterparty's screen), export is an exfiltration primitive that needs root-gating and its own audit
row, resolver columns duplicate `admin_actions`, and a statement page is the transactions page
filtered by handle. Each has a named trigger below.

**"Put spread and fee on the Quote type so the page gets them for free."** Simplest diff, but the
fee model is locked invisible and the `Quote` DTO is what the payer app receives. They go on
`AdminOrder` only; `toOrder` ignores extra columns, so `ORDER_SELECT` can carry them.

**"Give `Confirm` a text input instead of `window.prompt`."** Better UX (one modal, a cancel keeps
the text), about ten lines, and it would retire the KYB prompt too. Why not now: the prompt is the
console's existing pattern at five call sites, and a note field on the dialog is a small separate
cleanup, not part of the record.

**"Add `transfers.order_id` instead of chasing pointers and events."** Cleaner join, one column.
Why not now: a migration plus a backfill from two pointers and the event log, for a link the
pointer-plus-event union already gives; revisit if a third settlement writer ever appears.

## 4. Assumptions and falsifiers

- Bridge means "all transactions" literally, so plain sends and adds are in scope (§1 step 3). If
  Bridge means "the full record of each payment", step 3 drops to a later commit.
- The pilot's adjudicator is Bridge with the console, not a third party with a file. If a written
  external request arrives, CSV export comes back, root-only and audited.
- The mid needs no source column: `config.fxSourceUrl` is one value per deploy, the as-of stamp
  identifies the fetch, and a null as-of on a non-null mid means "fallback" (documented and
  rendered). If a second source is ever added, store the source too.
- `check-admin.ts` keeps passing: every change to `listOrdersAdmin` is an optional extra argument
  and every DTO change is additive. The check scripts delete only their own fixture rows and are
  unaffected by the seed guard.
- **Sequencing:** another session holds 20 dirty files on `stage` right now, among them
  `queries.ts`, `routes/admin.ts`, `contracts.ts`, `Nav.tsx`, `services/api.ts`,
  `merchants/page.tsx`, and an untracked `0028_bond_waiver.sql`. Every commit below touches at
  least one of those. Start only when `git status` shows them committed; stage by explicit path;
  never `git add -A`. The migration is scaffolded with `yarn db:new quote_mid_rate` (it numbers
  itself, `migrate.ts:46`) and will be 0029.

## 5. Open questions for Bridge (and the deferrals' triggers)

1. "All transactions" literal (sends and adds included, step 3 ships now) or per-payment record
   (step 3 later)? Assumed literal.
2. Does the admin need the LP's own bond ledger beyond the draw on the order page and the upheld
   count on the merchants page? Deferred; trigger = the first LP dispute about bond history.
3. The retention placeholder in docs/08 ("financial records 5 years from completion, contact PII 12
   months after soft-delete") is a statement of intent, not a compliance claim. Keep, change, or
   leave the doc silent?

Deferred, with triggers: CSV export (a written external request; ships root-only, audited, page
capped) · evidence upload (the first contested dispute where a screenshot decides it) · LP "amount
paid / paid to" on the paid step (the first short-pay dispute; today the UTR is the bank's evidence)
· admin read rate limits and tiered roles (more than a handful of admins) · a nav-global search (an
operator asks for it after using the page-level one) · `transfers.order_id` (a third settlement
writer) · raw scanned QR payload on the quote (a contested parse) · a note field on `Confirm` (the
next time a prompt annoys someone).

## 6. Implementation

### Commit 1: the order page shows the whole record (no migration)

Files: `packages/shared/src/contracts.ts`, `apps/backend/src/db/queries.ts`,
`apps/backend/src/routes/admin.ts`, `apps/backend/src/services/orderMachine.ts`,
`apps/admin/src/app/orders/[id]/page.tsx`.

- `ORDER_SELECT` (`queries.ts:1580-1594`) gains `q.spread_bps, q.platform_fee_usdc, o.group_id,
  o.expires_at, o.locked_at, o.lock_expires_at` (and `q.mid_rate, q.mid_rate_as_of` once commit 2
  lands). `toOrder` maps by name and ignores the extras, so the payer `Order` is unchanged.
  `AdminOrderJoinRow` adds `spread_bps: number` (integer column), `platform_fee_usdc: string`
  (numeric), `group_id: string | null`, the three timestamps; `toAdminOrder` (`:4529`) maps them.
  `AdminOrder` (`contracts.ts:850`) gains `spreadBps: number`, `platformFeeUsdc: string`,
  `groupId: string | null`, `expiresAt`, `lockedAt`, `lockExpiresAt` (ISO or null), later
  `midRate: string | null`, `midRateAsOf: string | null`.
- `AdminOrderDetailResponse.transfers` (`contracts.ts:878-883`) gains `amountUsdc`, `note`,
  `fromAddress`, `toAddress`, `createdAt`, `confirmedAt`, `orderReference`.
  `listOrderTransfersAdmin` (`queries.ts:4606`): rows from `orders o` where `o.id = $1 or
  o.group_id = $1` (the `listLegsForUser` predicate, `:1679`), ids = the two pointers union
  `(e.detail->>'transferId')::uuid` from `order_events e` on those orders where `e.event =
  'settle_dropped'` (null-safe when the key is missing; `detail` is jsonb, 0001:144); `select
  distinct on (t.id)` because a retried order yields one id twice and one fund row funds N legs;
  `order by t.created_at`. Carry `o.reference_code` per row.
- `settleEscrow` (`orderMachine.ts:466-472`): name any non-confirmed prior at the moment it is
  orphaned. `if (prior && prior.status !== 'confirmed') { if (prior.status === 'pending') { the
  existing age check → 'in_flight'; the chain check → 'in_flight'; setTransferStatus(prior.id,
  'failed') } appendOrderEvent(input.orderId, input.fromState, input.fromState, 'settle_dropped',
  { transferId: prior.id, signature: prior.signature }) }`. No new event name; the `:477`
  on-chain failure and the confirmer's parse failure are both covered on the next retry. Params
  are on `input`, not bare locals. `order_events.from_state / to_state` carry no CHECK
  (0001:138-146), so the refund caller's `'refunded'` inserts fine.
- `AdminOrderDetailResponse.dispute` gains `resolvedBy: string | null` (handle), `note`,
  `bondDrawnUsdc: string | null`. `getDisputeForOrder` (`queries.ts:4584`): `left join lateral
  (select a.note, u.handle from admin_actions a join users u on u.id = a.admin_user_id where
  a.target_kind = 'dispute' and a.target_id = d.id::text order by a.created_at desc limit 1)`, and
  `left join lateral (select sum(-b.amount_usdc) as drawn from merchant_bond_events b where
  b.dispute_id = d.id and b.kind = 'penalty')` (penalty only: an `adjust` must not net the draw
  away; `drawDownBond` writes no row when the bond was already 0, so null renders "-"). The mapper
  strips the `^(upheld|rejected): ` prefix the route prepends (`routes/admin.ts:449`). The note
  is console-only; its one reader is `listAdminActions` → `/audit` (invariant 21 holds).
- `AdminOrderDetailResponse.legs`: new `listLegsAdmin(orderId)` next to `listLegsForUser`
  (`queries.ts:1677`): `with g as (select coalesce(group_id, id) as gid from orders where id = $1)
  ${ORDER_SELECT} join g on o.id = g.gid or o.group_id = g.gid order by o.group_id nulls first,
  o.created_at` (the `getGroupSettlement` CTE, `:1689`, so a child leg's id resolves too), no user
  scope. The route (`routes/admin.ts:124-135`) adds it to the `Promise.all`. Empty for a single leg.
- Page, above the timeline, one two-column "Record" table in call order: fiat + currency · USDC ·
  payee name · payee destination + rail + operator (`vpaOperator` from `@fpay/shared`, the
  partner screen's "Processed by" line, `apps/lp/.../orders/[id]/page.tsx:182`) · UTR · claimed
  at · window (expires at, locked at, lock expires; null expires with `under_review` reads
  "frozen by dispute") · partner · reference · created / updated · then all-in rate · mid at
  strike ("-" before 0029, "fallback" when the mid is set and as-of is null) · spread bps ·
  platform fee. All times absolute (`at()`). Then "Parts" (only when `legs.length > 1`):
  reference, state, USDC, fiat, UTR, each linking to its own page. Transfers table: Kind (note on
  line two), Amount, From → To (short addresses), Order reference, Status, Created / Confirmed,
  Signature as the Solscan anchor from `merchants/page.tsx:207`. Dispute card adds resolver, note,
  bond drawn. Reuse `Table`, `Td`, `usd`, `at`, `Badge`, `Who` from `components/ui.tsx`.

### Commit 2: capture what is lost, guard what can erase it (one migration, Bridge-run)

- `yarn db:new quote_mid_rate` → `apps/backend/src/db/migrations/0029_quote_mid_rate.sql`: `alter
  table quotes add column if not exists mid_rate numeric(20,6); alter table quotes add column if
  not exists mid_rate_as_of timestamptz; create index if not exists idx_orders_release_transfer
  on orders (escrow_release_transfer_id);` Columns nullable: old rows have none. The index serves
  commit 3's join (the fund pointer already has `idx_orders_fund_transfer`, 0019).
- `fxRate.ts:37`: the fallback branch returns `Number(v.toFixed(4))`, the same rounding
  `parseRate` applies on ingest (`:31`), so every mid is 4dp and pricing consumes exactly what is
  stored. `quoteEngine.ts:46-48` already holds `mid`; pass `midRate: formatAmount(amt(mid),
  RATE_DECIMALS)` (cannot throw once the mid is 4dp) and `midRateAsOf: getMidRateAsOf(input.currency)`
  into `insertQuote` (`queries.ts:1433`), two more columns in the INSERT. `toQuote` does not map
  them (the payer never sees the mid). One value for a split: `planLegs` prices every leg off the
  same `mid` (`quoteEngine.ts:60`) and `legs` jsonb holds per-leg fiat + USDC.
- Required note on resolve: `routes/admin.ts:437-441` returns 400 `note_required` on a blank or
  missing note BEFORE `settleDispute` runs (it is irreversible), the rule the KYB route applies to
  everything but an approval. Console (`page.tsx` `resolveConfirm`): mirror `merchants/page.tsx:69,
  92-105` exactly, the `window.prompt` inside `onConfirm` after the dialog, `if (!note) return;`
  on cancel or whitespace, then `api.resolveDispute(id, resolution, note)` (`api.ts:151` already
  takes it).
- Seed guard, `db/seed.ts` right after `const pool = getPool()` (`:20`, before the first
  mutation at `:23`): `await assertDatabaseTier()` (`db/tier.ts`, the check `db:deploy` already
  runs; refuses a production stamp from a development process), then `select 1 from transfers
  limit 1`: a row means this database holds money, so log "refusing: this database holds
  transfers; use db:reset for a fresh one" and exit 1. No bypass flag: on a mainnet-everywhere
  repo there is no legitimate seed of a database with money in it, and `db:reset` + `db:init` +
  `db:seed` is the fresh-database path that already exists.
- Same commit, hygiene: delete `reconcileBridgeAmount` (`queries.ts:4493-4506`), dead and the only
  ungated amount rewrite on `transfers`. Deletion over a guard.

### Commit 3: Transactions page and search

- `listTransfersAdmin(limit, cursor, q?)` in the admin block of `queries.ts`, modelled on
  `listRiskEventsAdmin` (`:4761`): `transfers t left join users fu / tu`, `left join orders fo on
  fo.escrow_fund_transfer_id = t.id and fo.group_id is null` (one fund row funds N legs; every
  existing join adds the same predicate, `:560, 734, 1982, 2006`), `left join orders ro on
  ro.escrow_release_transfer_id = t.id`, `left join bridge_transfers b on b.transfer_id = t.id`.
  Aliases `fo` / `ro`, never `of` (a reserved word). Columns: id, kind, status, amount, from
  (handle + address), to (handle + address), note, signature, chain, order id + reference
  (`coalesce(fo.id, ro.id)`, same for reference), bridge state + chains, created, confirmed. Keyset
  on `(created_at, id)`, `clampLimit` / `parseCursor` (`:112-120`).
- `q` is exact-match, dispatched by shape server-side, bound as `$n` in every branch: starts with
  `@` → `canonicalHandle` (`queries.ts:86`; returns null on garbage → empty page) against
  `fu.handle` / `tu.handle`; contains `@` elsewhere → `.trim().toLowerCase()` (the `auth.ts:118`
  rule; there is no backend `normalizeEmail`) against `fu.email` / `tu.email`; matches the uuid
  regex (no `isUuid` helper exists; inline `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`)
  → `t.id = $q::uuid or fo.id = $q::uuid or ro.id = $q::uuid`; else `t.signature = $q or
  coalesce(fo.reference_code, ro.reference_code) = $q`. Every branch hits a unique index. A
  non-match is an empty page, never a 400.
- `listOrdersAdmin` (`:4536`) gains the same optional `q` (reference code, handle, email, order
  id). Never `payout_destination` (a VPA-to-person oracle).
- Both routes (`routes/admin.ts:114-121` and the new `GET /admin/transfers`): when `q` is present,
  `insertAdminAction({ adminUserId, action: 'ledger_search', targetKind: 'shape', targetId: <handle
  | email | id | signature | reference> })`, the shape only, never the value. It lands on `/audit`
  unchanged. DTOs `AdminTransfer`, `AdminTransfersResponse` next to `AdminRiskEvent` in
  `contracts.ts`. `api.ts`: `transfers(cursor, q)`, `orders(cursor, q)`.
- Trust-boundary fix the page makes visible: `routes/money.ts:182` passes `note` from the body to
  `createPendingTransfer` (`:315`) with no type check, no trim, no cap, into an unbounded `text`
  column; `:137` one screen up does it right. Copy that line: `typeof body.note === 'string' &&
  body.note.trim() ? body.note.trim().slice(0, 80) : null`.
- `apps/admin/src/app/transactions/page.tsx`: the risk page's shape (`usePaged`, `Table`,
  `LoadMore`), one input for `q`, seven columns with two-line cells the way `OrderRows` puts the
  email under the handle: From → To (address under handle) · Kind (note under) · Amount · Status
  (bridge state + chain under) · Order (reference linked to `/orders/[id]`, state under) ·
  Signature (Solscan, short) · When (`at()`, absolute, as `risk/page.tsx:57` does). Nav: a
  "Transactions" link after Overview; `active()` (`Nav.tsx:27`) already falls through to
  `startsWith`, no change. On `/`, the same input goes inline in the filter-chip row
  (`page.tsx:207-220`) so it belongs to the table it filters; nothing else on `/` moves. No em
  dashes (`check-copy.mjs:116-126` gates them in `apps/admin/src`); say "partner" in new copy.

### Commit 4: redaction, the dispute count, docs, memory

- `ORDER_SELECT` becomes `orderSelect(payee = true)`: the fragment emits `q.payout_destination` /
  `q.payout_name` or `null::text` under the same aliases, so no duplicate output column and no
  reliance on `pg` field order. `listOrdersAdmin` builds `ADMIN_ORDER_SELECT` from
  `orderSelect(false)`; `getOrderAdmin` and every payer read keep `orderSelect()`. One fragment,
  two attach points, the `payeePaidSql` shape (`:2254`).
- Merchants page: `listMerchantsAdmin` (`:4807`) folds in `merchantDisputeStats()` (`:2384`, the
  90-day upheld count per merchant that already drives `dispute_rate`); `AdminMerchant` gains
  `disputesUpheld90d: number`; the column shows "2 upheld (90d)" beside the rate
  (`merchants/page.tsx:341`). The cheapest answer to "how many did partner X lose".
- docs/07 §Console surface: the Transactions page, the Record block, search + `ledger_search`,
  the required note, the seed guard. docs/09: `quotes` row gains `mid_rate`, `mid_rate_as_of`
  (null as-of = fallback) and the why (evidence, not display); 0029 in the migrations list.
  docs/08 §8: one retention paragraph marked placeholder. docs/05: one line that the mid is
  stored and never displayed. docs/06 §6: the settle-dropped event names every orphaned row.
- `docs/21-admin-ledger.md`: this plan in expert format with the changelog and telemetry (the
  prism persist step; the plan file is the draft, the doc is the record).
  `.prism/project-model.md`: decision log entry linking docs/21, the invariant below, the three
  open questions under "Counsel flags & open questions", the telemetry block, and one lesson:
  "a critique's remedy is a claim too: `settle_failed` at the failure site missed the confirmer's
  path; naming the row where it is ORPHANED (the pointer overwrite) covered every writer". Memory
  file `admin-ledger-plan.md` in the auto-memory dir + an index line.

### New invariant (to record in `.prism/project-model.md`)

"A struck quote stores its mid (`quotes.mid_rate`, 4dp, `mid_rate_as_of`; null as-of on a set mid
= fallback); the payer sees the all-in rate only. Every settlement transfer that ever touched an
order or its legs is reachable from the order: the two pointers plus
`order_events.detail->>'transferId'` on `settle_dropped`, which is written for ANY non-confirmed
prior at the moment the pointer moves. The bulk admin orders list never carries a payee; the
single-order read does. `db/seed.ts` asserts the database tier and refuses a database that holds
any `transfers` row. A search on an admin list writes `ledger_search` with the query's shape."

## 7. Verification

- `yarn typecheck` and `yarn check:all` green (additive DTOs; `check:api:admin` covers the new
  GETs; `check:copy` covers em dashes in admin prose). Note `check:all` (`package.json:35`) runs
  neither `check:admin` nor `check:fees`; both need the stage DB and are run by hand.
- `yarn workspace @fpay/backend check:admin` against the stage DB: extend §3 with assertions that
  `getOrderAdmin` returns `spreadBps` and the widened transfers, that every `listOrdersAdmin` row
  has `payoutDestination === undefined` (mandatory: it is the only thing holding the redaction),
  and that `listTransfersAdmin(50, undefined, '@zza_payer')` finds the fixture's rows.
- `check-fees.ts`: keep the exact-0.001 assertion; add that a fresh quote's `mid_rate` is
  non-null, 4dp, and inside the currency's `FX_BANDS`; and that a quote priced with
  `FX_FALLBACK_RATE=87.5512` (6dp) inserts rather than throws.
- Seed guard: `yarn db:seed` against a DB with one transfer exits 1 without deleting; against an
  empty migrated DB it seeds.
- Settle path: `check-escrow-pool.ts` or a new case in it: a `failed` prior release followed by a
  retry yields exactly one `settle_dropped` event naming the failed row, and
  `listOrderTransfersAdmin` returns both rows.
- Stage walk (Bridge): open an order page and read the Record block against the payer's receipt
  and the partner's Activity row for the same order; resolve a stage dispute and confirm the note
  lands on the dispute card and in /audit; search Transactions by a handle and by a signature and
  see the `ledger_search` rows in /audit.
- Migration 0029 is Bridge's to run on stage (`yarn db:migrate`); new quotes carry the mid after
  it, older rows show "-".

## 8. Changelog (prism loop)

- Round 0 → v2 (verify): grounding 21/25 verified, 4 corrected (transaction shape of the dead
  reconcile; seed.ts deletes; no backend `normalizeEmail`; `Confirm` has no input). Skeptics 2 Opus
  + 1 Sonnet: C1 mid-rate 3-0 survived, threshold restated as `lpRate²/amountFiat < 100`; C2 app
  write-once 3-0 survived, its "no delete path" clause STRUCK (seed.ts) → seed guard required; C3
  wire fields 3-0 survived, "dropped legs linkable" clause STRUCK (failed-on-chain orphan,
  re-read and confirmed) → event on every orphan; C4 redaction 3-0 survived.
- Round 1 (critique, 4 lenses, 34 items): the recommendation did not move; 24 implementation fixes
  folded. Fell or changed: `settle_failed` at the failure site → `settle_dropped` at the orphan
  site (covers the confirmer's path too); `q2`/`o2` joins → columns on `ORDER_SELECT`; 0028 →
  0029 (another session holds 0028 uncommitted); `formatAmount` would throw on a 6dp fallback →
  round the fallback at the source; `SEED_WIPE_OK` bypass → no bypass + `assertDatabaseTier`;
  duplicate-column redaction → `orderSelect(payee)` fragment; `of` alias → `fo`; leg release rows
  unreachable from the primary → the legs predicate + distinct; penalty-only sum on the dispute
  card; `ledger_search` audit row by shape; the unbounded send note capped at 80; Record block
  reordered for the two common calls + the window timestamps + the VPA operator; upheld-dispute
  count on the merchants page; `Nav.active` needs nothing. Refuted by grounding: "check:copy does
  not gate em dashes" (it does, `check-copy.mjs:116-126`, admin included). Rejected: a text input
  on `Confirm` (kept the existing prompt pattern; deferred with a trigger).
- Round 2: not run. Round 1 changed no recommendation, every fold is a file:line-cited
  implementation detail, and all four load-bearing claims survived verification; the draft held
  at the decision level. Unresolved: the three questions in §5.

## Telemetry
- divergence: 0.74 (evidence 0.78, conclusion 0.68) | threshold 0.30 UNCALIBRATED
- models: draft=fable · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: C1 grounded · C2a grounded · C2b struck · C3a grounded · C3b struck · C4 grounded
- fleet: 8 lenses + 4 critique + 1 grounding verifier + 3 skeptics (16 agents)

> Cross-tier verification reduces instance-/tier-level error correlation but not shared-lineage
> blind spots. Treat cross-tier survival as weaker evidence than grounding.
