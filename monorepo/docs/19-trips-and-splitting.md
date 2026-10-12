# 19 · Friends, trips, and bill splitting

Friends are personal saved Frenspay accounts. Bills record allocations separately from the transfers
that paid for them. Payment requests represent the resulting reimbursements, not each person's share.
This replaces the original 0026 split model; migration 0032 preserves its request and transfer IDs.

## Finding people and inviting them

The shared web/mobile people picker accepts usernames and phone numbers. A selected device contact
prefills a directory lookup; there is no background address-book upload. Saved friends use account IDs
so renaming a username does not lose a friendship. Favorites and removal affect only the owner's list.

Suggestions prioritize the selected trip, favorites, repeated time-of-day/weekend patterns, frequent
interactions, then recency. History covers 90 days; a routine requires three matching interactions.
The picker suggests groups without adding their members until the user chooses one. Device location
and other people's location are not collected for suggestions.

An unregistered number can receive an invitation through the inviter's own SMS composer. The user
chooses whether to send it. The invitation contains an unused code owned by that user and their
username; unavailable SMS has a copy fallback. Lookup failures never masquerade as unregistered
numbers. The invitee becomes selectable only when directory lookup resolves their Frenspay account.
An invitation alone never creates a participant, debt, external payment, or automatic SMS.

## Bill workflow and accounting

Start a bill from a completed eligible Frenspay payment. The creator can save a draft, choose people,
assign a trip, review reimbursements, and publish. Drafts do not issue payment requests. Participants
can link their own additional eligible payments; the creator redistributes shares and reviews again.
Only the owner of an additional payment can unlink it. The initial payment and contributing
participants cannot be removed. Linking/unlinking requires saving any unsaved draft first.

Bills support up to 21 participants including the initial payer. Equal splitting rounds nonpayer
shares down to cents; the initial payer receives the exact remainder. Accounting stays in canonical
USD/USDC with six decimal places. Manual allocations survive adding or removing people; new people
initially have zero when custom amounts are in use. Equal/custom mode persists across saving and reopening. **Split equally again** explicitly redistributes.
Original fiat amounts are display context, not a second ledger.

Contributions and shares are independent. If Alice pays $90 and Bravo $30 for a $120 bill with three
$40 shares, Bravo owes Alice $10 and Chris owes Alice $40. Matching is deterministic and per bill;
there is no cross-bill or cross-trip netting. A one-time merchant QR can be paid once by one person,
then reimbursed through Frenspay. This adds no payment rail or manual/external settlement method.

Trip membership and bill participation are separate. Outsiders can access the bill they share but
not the trip's other bills or roster. A $120 bill with two $40 trip-member shares contributes $80 to
trip cost. Full bill amounts and outside participants remain visible on the bill. Membership snapshots
are taken on assignment/addition and preserved through note edits and publication, even if the roster
changes later. Changing the bill's trip explicitly takes a new snapshot.

Activity's monthly **Spent** measures outgoing cash; **Your share** counts published allocations once,
including unpaid debts, plus unsplit spending. Reimbursements do not add another personal expense.
Lists use cursor pagination; summary totals are calculated on the server across the full month.
Source payment eligibility is checked for selection, bill review, and allocation totals. Incomplete
merchant payouts, failed transfers, bridge funding, operational-wallet transfers, and reimbursements
cannot become new bill contributions. A source reversal pauses further settlement and flags the bill.

## Review, settlement, and recovery

Reads use a consistent snapshot. Financial mutations require the current version and serialize on
the bill row. Review freezes that saved revision; background changes invalidate confirmation rather
than silently replacing the amounts being approved. Publication retries with the original reviewed
version return the same debt requests. Notifications are inserted with publication in its transaction.

Preparing a reimbursement atomically reserves a transfer on the debt and locks financial edits to
the bill. Debtor, creditor, amount, and current source eligibility are checked server-side. A unique
index permits only one live transfer per request. The signed transaction carries an opaque
`FPAY-BILL:<transfer-id>` memo. Historical transfers are exempt from the new memo requirement.

The client stores an attempt key before invoking the wallet and persists its signature when possible.
After broadcast, submission still runs if receipt storage fails. A lost submit response is retried
without another signing operation. Clearing local storage after successful submission is best effort.

The confirmer verifies mint, authority, destination, amount, and attempt memo before marking a new
reimbursement confirmed or authoritatively failed. A mismatched receipt cannot release a reservation.
A paginated source-account history scan recovers broadcasts whose client receipt was lost. RPC gaps,
unknown wallet results, and absent signatures remain pending and cannot produce another transaction.
There is deliberately no timeout-based retry for ambiguous reimbursements: an unresolved attempt can
remain pending until its chain status is established. A build failure before a transaction is returned
to the client, or a verified failed transaction, permits a fresh attempt. No live funds move in tests.

Confirmed transfers and request status are reconciled on every worker pass, so a crash between those
updates heals automatically. The request-paid notification is inserted in the same SQL statement as
that transition. Once settlement starts, financial edits remain locked even after a failed attempt.
Historical manually recorded payments remain read-only; new manual payment ticks are rejected.

## Interfaces, migration, and checks

- `/friends`: list, save/favorite, remove; `/friends/suggestions` and `/friends/invite` support the picker.
- `/expenses`: cursor-paginated bills; `/expenses/eligible-payments`: cursor-paginated contributions;
  `/expenses/summary`: server-side monthly totals with local time zone and trip/personal filtering.
- `/expenses/:id`: versioned draft edits; `/payments`: link/unlink; `/publish`: publish reviewed debts.
- `/transfer/prepare` accepts `requestId`; request and bill responses distinguish pending from paid.
- Legacy transfer split/move endpoints validate input and adapt to the same atomic bill workflow.

Apply 0032 through the normal migration deployment process before releasing the corresponding API.
It backfills existing bills, preserves historical request identities and settlement links, and moves
trip ownership from source transfers to bills. It has not been applied to stage or production as part
of this work. Existing F-list access gates still apply. No deployment is implied by local validation.

Run from the monorepo with its supported Node runtime:

```sh
yarn check:expenses
yarn check:expenses:db
yarn check:expenses:postgres
yarn check:expenses:browser
```

The database suite uses declared PGlite dependencies by default. The PostgreSQL variant starts an
isolated temporary server from the declared embedded-postgres package, uses real connections for
lock races, then stops it and removes only its temporary data. Neither variant reads or writes an
application database. The browser suite uses actual shared sheets, the people picker, API client,
and wallet provider against a loopback fixture server. It uses installed Chrome by default; set
`PLAYWRIGHT_CHANNEL=chromium` to use a Playwright-installed Chromium. Tests cover invitations,
stale lookups, manual shares, review invalidation, masking, lost receipts, and storage failures.
