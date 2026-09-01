# 17 · Handle + email: named together, one rule per input, adopt before you ask

**Decision (Bridge, 2026-09-01):** three asks in one breath — "on the admin side I don't see the
user's email and their username together"; "regex check on username, trimming and such, same for
email, on inputs"; "the same email is the fpay account, so if the merchant is already there, don't
ask for an fpay account again". Prism plan `~/.claude/plans/on-admin-side-i-cheeky-ullman.md`.

## What was actually wrong

- The admin **Users** table already showed both. Every *other* admin page named a user by handle
  alone (dashboard, orders, risk, audit) and Merchants showed neither — their SELECTs already joined
  `users`, the email was one column away.
- Handles were already canonical on every backend write (`canonicalHandle`: trim, strip `@`,
  lowercase, `^[a-z0-9_.]{3,30}$`), mirrored in `@fpay/shared` and drift-checked. The client side was
  ragged: the same repair regex pasted into three setup screens, no 30-char cap, no `invalid_handle`
  copy in the payer app.
- **Email was the real gap.** It entered the backend in one place (`getLinkedEmail`) verbatim and was
  inserted, matched for adoption, repaired and uniqued as an exact string — with a case-sensitive
  unique index chosen on the bet that Privy always returns one spelling per mailbox. Privy documents
  no such thing. One mailbox spelled two ways was two accounts, and the second would be asked to
  "finish setting up" an account it already had.
- The LP console's `FinishSetup` (shipped that morning, [11](11-lp-console.md)) asked *every*
  returning partner to choose a handle that adoption then discarded — because "nothing can tell the
  two apart before the call". The verified email can.
- Found on the way: a denylist handle was stored raw while `screenHandle` matched canonical (a
  sanctions row nothing could hit, filed with a 200); `{"handle": 1}` at `/auth/sync` was a 500; the
  invite-mint audit row recorded the typed owner rather than the matched one.

## What shipped

1. **`/auth/sync` takes no handle** to mean "adopt what this Privy-verified email already owns (or
   re-sync this DID's own row)", and answers **400 `handle_required`** when there is nothing to adopt
   — before the invite gate, so a new person is asked for a name first and a code second. The
   transaction decides, not the route's pre-flight: an admin delete between the two would otherwise
   have inserted a fresh account under the freed old handle with no invite. Invariants 45/48 hold —
   adoption still lands the new wallet and re-points the treasury in the same statement block.
2. **Every setup screen probes first** (LP `FinishSetup`, web + mobile `HandlePrivy`): a sync with no
   handle on mount; `Splash` meanwhile; the form only on `handle_required`. A returning partner sees
   "Welcome back, @…" and nothing else. A Privy read hiccup falls back to asking, as before.
3. **Email has one canonical form** — lowercase, trimmed — written at the single entrance
   (`getLinkedEmail`), rewritten onto existing rows by migration **0025**, and enforced by
   `CHECK (email = lower(btrim(email)))`. A CHECK rather than a `lower(email)` index: every reader is
   `where email = $1` and keeps its plain index; a raw writer fails loudly instead of creating a twin.
   The three login screens send `normalizeEmail()` and gate on `isValidEmail()` from
   `@fpay/shared/email.ts` (byte-identical copies in `routes/waitlist.ts` and landing, by rule).
4. **`draftHandle`** in `@fpay/shared` replaces three pasted regexes on the setup screens
   (repair-as-you-type is for your OWN name; `canonicalHandle` rejects and is for anyone else's), plus
   `maxLength={30}` and `invalid_handle` copy in the payer app. Admin inputs that name someone else
   stay reject-mode.
5. **`Who`** — `@handle` over email, one cell — on every admin page that names a person; Merchants
   gains an **Account** column with the owner's fpay identity; `userEmail`/`adminEmail`/`ownerEmail`
   ride on the DTOs. Denylist handles are stored canonical; the invite audit names the matched owner.

## Rejected, with the reason

- Fix the LP screen only — the web dead end (`bootRoute.ts` header) is the same bug in the same route.
- Let `GET /me` adopt — no wallet address, so no invariant-45/48 transaction.
- `unique index on lower(email)` — unusable by every exact-match reader; the CHECK keeps the index.
- `draftHandle` on admin inputs — repairing `@Ne-ha` to `@neha` on a sanctions field targets someone else.
- Derive the handle from the email — rejected the same morning (publishes the local part on an
  immutable, payer-resolvable ID).

## Open

- Which screen Bridge was on (assumed: the handle-only pages). If the Users table showed `—` under
  Email, that is an unsynced row: `select count(*) from users where email is null and status = 'active'`.
- Migration 0025 is Bridge's to run (`yarn db:migrate`) after the push; its guard raises with a count
  if stage already holds one mailbox spelled two ways — admin decides which row keeps it.
- Any raw denylist handle rows: `select * from denylist where kind = 'handle' and value !~ '^@[a-z0-9_.]{3,30}$'`.
- A Privy read failure during the probe still makes a returning partner look new (pre-existing).

## Telemetry
- divergence: 0.78 (evidence 0.86, conclusion 0.67) | threshold 0.30 UNCALIBRATED
- models: draft=fable · lenses=3× Explore + 1× Plan critic (plan mode: skeptic trio NOT RUN; version axis unavailable)
- claims: C1 adoption-ignores-handle grounded-after-correction · C2 email-raw-end-to-end grounded ·
  C3 admin-columns-not-bug grounded · C4 handle-canonical-on-every-write grounded · C4b
  draftHandle-on-admin REFUTED · C5 probe-on-mount grounded · C6 denylist-raw-write grounded ·
  C7 privy-casing-undocumented grounded (two docs pages + type def)
- fleet: 3 lenses + 1 critic; loop stopped after round 1

> Cross-tier verification reduces instance-/tier-level error correlation but not shared-lineage
> blind spots. Treat cross-tier survival as weaker evidence than grounding.
