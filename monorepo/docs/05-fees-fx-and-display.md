# 05 · Fees, FX & how money is displayed

**What it is.** The one place the platform earns (a flat cut folded into the conversion rate), where
exchange rates come from, and the rules for how a dollar balance is written on screen — two
currencies, a flip, and an eye that hides the numbers.

---

## The fee model (decided 2026-08-13)

**Flat $0.001 per conversion, folded into the all-in rate. Plain USDC→USDC sends are free. The user
never sees a fee — anywhere, ever.**

- A *conversion* is any transaction where currency changes (a fiat payout order, a fiat-quoted
  deposit, FX between display currencies at settlement). App-to-app sends and sends to a wallet
  address move dollars unchanged — no conversion, no fee.
- The user sees exactly one number: the all-in rate ("$1 = ₹86.67"). No fee line items exist in any
  DTO, screen, or receipt. This is the continuation of the disclosure posture in
  [08-compliance-and-legalities](08-compliance-and-legalities.md) — a normal money app shows you the
  rate, not its margin.
- **This replaces the bps model.** Until 2026-08-13 the platform cut was `PLATFORM_FEE_BPS` (a
  percentage folded into the rate). The flat fold shipped the same day and the env knob is gone.
  Any doc/code text quoting `$0.45`, `$0.09`, or a default-50-bps cut is historical.

### The fold — how $0.001 becomes a rate ✅ shipped 2026-08-13

The old bps fold could not express a flat amount (it rounded away at 4 dp on a big order and
silently became 10 bps at the $1 minimum), so `quoteEngine.ts` now computes the fee first and
derives the rate from it — `PLATFORM_FEE_USDC = 0.001` is a constant, not a knob
(`PLATFORM_FEE_BPS` is retired), and `check-fees.ts` asserts flatness + conservation at both a
near-minimum and a large order:

```
lpRate          = mid × (10000 − spread_bps) / 10000          (round DOWN, 4 dp — unchanged)
lpUsdc          = divUp(amountFiat, lpRate)                    (what the LP is owed)
platformFeeUsdc = 0.001 exactly                                (flat, not derived)
amountUsdc      = lpUsdc + platformFeeUsdc                     (what the user pays)
rate (shown)    = amountFiat / amountUsdc                      (round DOWN, 4 dp — display only)
```

The displayed rate is *derived* and cosmetic; the split is exact. `quotes.platform_fee_usdc`
(migration 0006) carries the cut unchanged. Rounding keeps today's discipline: rates round down,
USDC owed rounds up, sub-cent dust always lands on the user-pays side so the LP is never short.

### Collection, refund, conservation ✅ (mechanics unchanged from the bps era)

- **Collection at deposit:** the funding transaction splits the user's USDC — escrow receives the
  LP's portion, the fee lands in the **fee-payer's ATA** (the same sink as CCTP fees). Chosen over a
  cold treasury *because* we hold that key: refunds can atomically return the fee.
- **Refund = make-whole:** vault + fee return in one transaction; a refunded user gets every
  fractional cent back.
- **Release** records `amount − fee` for the LP leg.
- **Guard:** `apps/backend/scripts/check-fees.ts` asserts the flat fee exactly, the fee-first sum,
  the derived rate, and conservation — at both a near-minimum and a large order.

At $1 (the order minimum) the flat fee is 0.1% — still below card-network territory; at $1,000 it is
0.0001% and vanishes inside the 4 dp rate display, yet is still collected exactly. That asymmetry is
the point: superlow, flat, honest in the ledger, invisible in the UI.

---

## FX rates ✅

Per-currency, banded, cache-per-slot — built for the Indonesia corridor and generalized since
(`apps/backend/src/services/fxRate.ts`):

- One upstream fetch (free source, full `rates` map) but **each currency has its own cache slot,
  plausibility band, and fallback** (`FX_BANDS`: INR 50–150, IDR 12k–25k). A garbage value in one
  currency can never poison another's quote; out-of-band values are rejected outright.
- `getMidRate(ccy)` is synchronous (cached value or configured fallback) — quoting never blocks on
  the network. `startFxRefresher()` keeps slots warm; a failed refresh keeps last-good values.
- Clients fetch only the currencies this user needs (live rails ∪ their country ∪ their display
  choice) via **authed** `GET /fx/rate?currency=` (`apps/backend/src/routes/system.ts`). The route
  is authed because the upstream's ToS forbids public re-export; the required attribution link
  lives in the web Settings footer.
- `DISPLAY_CURRENCIES` (`packages/shared/src/money.ts:71`) gates what a balance may be *shown* in:
  USD plus corridor currencies we hold a live mid for. A currency with no rate is never displayed
  converted — dollars are shown instead, because a stale or invented rate is worse than none.

---

## Balance display — two currencies, one flip

**The rule (decided 2026-08-13):** a balance is written in up to two currencies, stacked — the big
figure on top, the small conversion under it (`~$4.40` style). Tapping the small line **flips**
which currency is on top. If the two would be the same currency, the second line is simply absent.

| Piece | Status |
|---|---|
| Two-currency stack: preferred big + local small, absent when equal | ✅ `apps/web/src/hooks/useBalanceDisplay.ts` — the one definition, used by Home's hero and Activity's summary |
| Preferred currency as a user choice (USD default, INR/IDR offered by country) | ✅ `displayCurrency` in the store, picker in `apps/web/src/components/sheets/Currency.tsx` (list is derived: USD + what the user's country spends) |
| Local currency derived from profile country (locale-seeded at signup, `POST /me/country` override) | ✅ `currencyForCountry(users.country)` |
| **Local as an independently pickable setting** | ✅ `sheets/LocalCurrency.tsx` — pin any display currency or Automatic (the full list on purpose: the pin exists to override the country derivation) |
| **Server-stored prefs: `users.preferred_currency` + `users.local_currency`** | ✅ code + migration 0011 (`/me` + `POST /me/preferred-currency` + `/me/local-currency`; optimistic store writes, server truth wins on load) — 🟡 until `db:migrate` applies on stage |
| **The flip** (tap small line → currencies swap positions) | ✅ one ephemeral store flag read by `useBalanceDisplay` — Home and Activity always agree; deliberately not persisted |

De-crypto rule carried: USD *is* the balance's real denomination (USDC never appears by name);
every other currency is a live-rate restatement, and `secondaryCurrency()`
(`packages/shared/src/money.ts:94`) is the single pure rule for whether a second line exists —
asserted in `scripts/check-money.ts`.

## The eye — hiding amounts ✅ shipped 2026-08-13

Privacy toggle for using the app in public:

- One **eye button** beside the balance hides **every** amount: the balance stack and all
  transaction amounts (list + detail), masked as `•••` — layout keeps its size so nothing shifts.
- While globally hidden, each transaction row gets its **own eye** revealing just that row,
  ephemerally (cleared on navigation) — check one payment without undressing the whole screen.
- The global state is device-local and persisted client-side (privacy of *this screen in this
  pocket* — deliberately not synced, unlike currency prefs; a shared-device reveal shouldn't follow
  you to your phone). Masking lives inside `useBalanceDisplay` (both balance screens for free) and
  `components/ui/MaskedAmount.tsx` (rows, requests, and the detail page — which bypasses the hook
  and is masked explicitly). Per-row reveals are local state: they clear on navigation.

---

## Key files

`apps/backend/src/services/quoteEngine.ts` (the fold) · `apps/backend/src/services/fxRate.ts` +
`scripts/check-fx.ts` (rates) · `apps/backend/src/routes/system.ts` (`/fx/rate`) ·
`quotes.platform_fee_usdc` (migration 0006) · `apps/backend/scripts/check-fees.ts` (conservation) ·
`apps/web/src/hooks/useBalanceDisplay.ts` · `apps/web/src/components/sheets/Currency.tsx` ·
`packages/shared/src/money.ts` (`DISPLAY_CURRENCIES`, `secondaryCurrency`, `fiatRaw`)
