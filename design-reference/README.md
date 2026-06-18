# Handoff: "Pay" — travel payments app

## Overview
**Pay** is a mobile payments app (390 × 844, iOS-style) for inbound foreign travelers in India. A traveler holds a **US-dollar balance** and spends it in **rupees** instantly by scanning any UPI QR, at an exchange rate **locked the moment they pay**. They can also send/request money with friends. The balance is backed by USDC, but **no crypto language appears anywhere in the UI**.

The one job: make *"load dollars once, pay like a local, instantly"* feel effortless and trustworthy. The product must read as a **calm, premium consumer fintech** — never a crypto app, never the generic blue-gradient fintech look.

## About the design files
The files in this bundle are **design references created in HTML/React+Babel** — runnable prototypes showing intended look and behavior. They are **not production code to copy directly**. The task is to **recreate these designs in your target codebase** using its established patterns, component library, and conventions (React Native, Swift/SwiftUI, Flutter, etc.). If no app environment exists yet, choose the most appropriate native-mobile framework and implement there. Treat the HTML/CSS as the source of truth for **visual spec and interaction behavior**, not as code to ship.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, shadows, and interactions are all specified below and in `pay.css`. Recreate the UI pixel-accurately using your codebase's libraries. Every measurement and hex value here is intentional.

---

## Design tokens

### Color
| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F5F6F4` | App background |
| `surface` | `#FFFFFF` | Cards, sheets, rows |
| `ink` | `#16181C` | Primary text, dark fills, ink buttons |
| `muted` | `#8A8E94` | Secondary text, labels, inactive icons |
| `hair` | `#EAEBE8` | Hairline borders (1px) |
| `accent` | `#0E7A63` | Emerald — primary actions, the **rupee** side of money, success, active nav, "rate locked" dot |
| `ink-soft` | `#F1F2EF` | Neutral fills behind icons, keypad press, segmented track |
| `accent-soft` | `color-mix(accent 13%, white)` ≈ `#E4F2EC` | Accent tints/chips, success badge bg, QR row icon bg |
| `accent-shadow` | `color-mix(accent 32%, transparent)` | Glow under primary buttons & the Pay nav button |
| scrim | `rgba(16,18,20,0.42)` | Dim behind bottom sheets |

**Accent discipline:** emerald is used *surgically* — primary buttons, the rupee figure, success states, active nav, the rate-locked dot, positive (+) amounts. Everything else is ink/muted on white. Do not introduce additional accent colors.

### Typography
- **Display** — `Schibsted Grotesk`, weights 700–800, letter-spacing −0.01 to −0.03em. Used for: balance, screen titles, sheet titles, big amount entry, result headlines.
- **Body** — `Inter`, weights 400–600. All UI text, buttons, captions.
- **Mono** — `Spline Sans Mono`, weights 400–600, `font-variant-numeric: tabular-nums`. **Every money figure, exchange rate, @handle, timestamp, reference number.** This is a brand rule — money is never set in the body font.

Type scale (size / weight / font):
| Element | Size | Weight | Font |
|---|---|---|---|
| Hero balance (₹/$ big) | 52px | 800 | Display |
| Big amount entry (keypad screens) | 56px | 800 | Display |
| Result headline ("₹500 paid") | 26px | 700 | Display |
| Screen title (Activity, Detail) | 24px | 700 | Display |
| Sheet title | 21px | 700 | Display |
| Flip-card figures | 27px | 700 | Display |
| Rate-lock figure (Columns/Stacked) | 25–30px | 500 | Mono |
| Rate-lock figure (Receipt hero) | 38px | 500 | Mono |
| Row name / list item | 15px | 500 | Body |
| Row amount | 15px | 500 | Mono |
| Body / lead copy | 14–15px | 400 | Body |
| Caption / sub | 13px | 400 | Body |
| Eyebrow label | 11px | 500–600 | Mono, UPPERCASE, letter-spacing 0.13em |
| Rate-lock micro-label | 10.5px | 500 | Mono, UPPERCASE, letter-spacing 0.08em |

### Spacing & shape
- **Screen gutters:** 20px left/right.
- **Radii:** device frame 48px · sheets 30px (top corners only) · cards/lists 18px · rate-lock card 20px · tiles & fields 14–16px · rows 14px · buttons fully pill (999px) · icon squares 10–11px.
- **Borders:** 1px solid `hair` on all cards/rows/fields.
- **Shadows:**
  - Cards/tiles/rows: `0 1px 2px rgba(16,24,28,.03–.04)`
  - Rate-lock card: `0 1px 2px rgba(16,24,28,.04), 0 14px 34px rgba(16,24,28,.07)`
  - Bottom sheet: `0 -10px 40px rgba(16,24,28,.16)`
  - Primary button: `0 8px 20px var(--accent-shadow)`
  - Pay nav button: `0 10px 22px var(--accent-shadow), inset 0 1px 0 rgba(255,255,255,.2)`
- **Buttons:** height 54px (primary CTAs) / 46px (inline). Primary = accent fill, white text. Ink = `ink` fill, white text. Secondary = white fill, ink text, hairline border. Active state `transform: scale(.985–.97)`.

### Constants
- Exchange rate: **1 USD = 87.55 INR** (`RATE = 87.55`). Rupee = `round(usd × 87.55)`, formatted with `en-IN` grouping and a `₹` prefix.
- Rupee symbol is **₹** (not "Rs"). Dollar is `$n.nn`.

---

## Global chrome

**Status bar** (52px): mono `9:41` left; signal bars + battery glyph right (ink).

**Bottom nav** (86px, white, 1px top hairline, z-index above content): three targets —
- **Home** (left) — house icon + label; emerald when active.
- **Pay** (center) — 62px emerald circle **lifted 22px above the bar**, QR glyph in white, `0 10px 22px accent-shadow`; label "Pay" muted below. This owns the pay action (there is intentionally **no** Pay tile on Home).
- **Activity** (right) — list icon + label; emerald when active.

---

## Screens / views (19)

> Layout note: every screen is a 390×844 frame = StatusBar (52px) + content + (Home/Activity only) bottom nav (86px). **Bottom sheets** slide up over a scrim and cover most of the height (`top: 36px` for tall sheets, content-height for short ones), with a 38×4px grab handle, a header row (title + circular × close), then a body with 20–22px gutters. **Full screens** (Detail, Settings) replace the whole frame and have a circular back-chevron button top-left.

### Onboarding & identity (shortest path to first payment)

**14. Welcome (full screen).** Centered ink "P" logo (56px, radius 16); Display 32 headline "Pay like a local, anywhere you travel."; muted subhead "One balance in dollars. Spend in rupees, instantly."; bottom primary "Get started" + muted text-link "I already have an account" (skips to Home).

**15. Face ID / passkey (full screen).** Back chevron; 88px ink-soft circle with Face-ID glyph; Display "Set up with Face ID"; muted "No passwords, no seed phrases. Your account is secured on this device."; primary "Continue with Face ID".

**16. Choose handle (full screen).** Back chevron; "Choose your handle" + "Friends use this to pay you."; a field with muted `@` prefix, `bridge`, and an emerald availability check badge; mono emerald line "@bridge is available"; primary "Continue".

**17. Add first dollars (full screen).** Back chevron; "Add your first dollars" + "Load once, then spend in rupees anywhere."; amount chips `$50 / $100 / $250`; `$` field; caption "Pay with Apple Pay or card."; primary "Add $100" → completes onboarding → Home.

**18. Add a backup / recovery (bottom sheet) — DEFERRED.** Not shown during the opening flow. Prompted **after the user's first successful payment** ("Done" on Success). "Add a backup" + "So you never lose access if you lose this phone."; two rows "Recover by email" / "Add a second device"; primary "Done" + muted "Set up later". Also reachable from Settings → Recovery.

**19. Verify identity / KYC tiers (bottom sheet) — JUST-IN-TIME.** Surfaced **the first time the user taps a merchant to pay** (between Scan and Amount), not up front. Title "Verify to pay merchants" + reassurance "A one-time check to pay shops across India. Your balance stays safe and untouched."; **Tier 1** card (accent-soft bg, check badge, `ACTIVE`) — "Send and receive with friends. Up to $100 per transfer."; **Tier 2** card (empty radio, `VERIFY TO UNLOCK`) — "Pay merchants across India. Passport + visa, about 2 minutes." + primary "Verify identity" (→ continues to Amount); muted "Not now". Also reachable standalone from Settings → Verification (title becomes "Verification").

### 1. Home (tab) — the hero
- **Header:** ink "P" logo square (30px, radius 9) + "Pay" wordmark (Display 19px) left; circular avatar "B" (34px, ink-soft) right → opens Settings.
- **Hero (default = INR-forward):** eyebrow `SPENDABLE IN INDIA`; a small **INR / USD segmented toggle** (mono, ink-soft track, white active pill) on the right; then the big balance in **emerald** `₹36,771` (Display 52/800); sub line mono `$420.00 balance · 1 USD = 87.55 INR`; caption "Your dollars, spent in rupees at a rate locked the moment you pay." Tapping the toggle flips to USD-forward (ink `$420.00` big, `~ ₹36,771` sub).
- **Action tiles:** 3-column grid — **Add · Send · Request** (white cards, hairline, icon in ink-soft square + label). *(Pay is the nav button, not a tile.)*
- **Recent:** eyebrow `RECENT` + "See all" (emerald) → Activity tab. List card with 2 rows.
- **Transaction row:** leading icon square (QR/emerald-soft for merchant pays, ink-soft arrow for sends/adds) · name + mono timestamp · right-aligned mono amount (`−$5.71`, with rupee `₹500` underneath for merchant pays; `+$200.00` in emerald for top-ups).

### 2. Add money (bottom sheet, short)
Title "Add money" + ×; lead "Top up your dollar balance."; 3 amount chips `$50 / $100 / $250` (selected = ink fill); "Other amount" field with `$` prefix; primary CTA "Add $100"; eyebrow `OR DEPOSIT USDC`; one row with QR icon, truncated mono address `7xBn…mK4q`, emerald "Copy" action.

### 3. Activity (tab)
Title "Activity" (Display 24); filter chips `All / Payments / Friends` (selected = ink fill); a mono day-label `TODAY`; list card of transaction rows (same row component as Home).

### 4. Transaction detail (full screen)
Back chevron; centered result block — emerald-soft badge with check (or + for top-ups), `₹500` (Display 26), muted merchant name; the **rate-lock card** (see below); a detail list (Status → emerald "Paid"; Paid from → `$5.71`; Date → `14 Jun, 09:24`; Reference → `#577665`); secondary CTA "Share receipt".

### 5. Settings (full screen)
Back chevron; profile row (52px avatar "B", mono `@bridge`, "Bridge"); list — Verification → "Tier 1"; Recovery → "Email set"; Display currency → emerald "INR"; Help and support; muted "Log out" + mono `v0.1` at bottom.

### 6. Scan (bottom sheet, tall)
Title "Scan & pay" + ×; a dark (#101316) rounded camera viewport (~250px) with **emerald corner guides** and a faint QR glyph; caption "Point at any UPI QR."; a demo merchant list (Anjuna Beach Cafe, Auto rickshaw, Mango Tree Restaurant) — tapping one → Amount.

### 7. Amount — pay (bottom sheet, tall)
Header eyebrow "PAYING" + merchant name; centered big `₹500` (Display 56) with mono `$5.71 from your balance` below; a **mono keypad** (1–9, `00`, `0`, `⌫`); ink CTA "Review" (disabled at ₹0).

### 8. Review (bottom sheet, tall) — the signature moment
Lead "Paying {merchant}. The rate is locked for this payment."; the **rate-lock card**; a "Balance after" key/value row; primary CTA "Pay ₹500"; muted "Back" link.

### 9. Success (bottom sheet, tall)
Title "Paid"; result block — emerald-soft check badge, `₹500 paid` (Display 26), then **emerald dot + "Paid instantly, from your dollars"** (this line is the differentiator — our float is pre-positioned, so there is *no* "connecting to merchant" wait); the **rate-lock card** again; ink CTA "Done".

### 10. Declined (bottom sheet, tall)
Title "Payment not sent"; result block — ink-soft × badge, `₹500 not paid`; reassurance "Your balance did not change." + "You need **$5.71** but have **$4.10**." (the fix); primary CTA "Add money"; muted "Cancel".

### 11. Send — pick a friend (bottom sheet, tall)
Title "Send to a friend" + ×; search field ("Search a name or @handle"); friend list — circular initial avatar, name, mono @handle, chevron. Tap → Send amount.

### 12. Send — amount (bottom sheet, tall)
Eyebrow "SENDING TO" + @handle; centered `$12` (Display 56) with mono `~ ₹1,051`; mono keypad; primary CTA "Send $12" (disabled if 0 or > balance). Note: send amounts are entered in **dollars** (mirror of merchant-pay which is in rupees).

### 13. Request money (bottom sheet, tall)
Title "Request money" + ×; centered `$20` (Display 56) with mono `~ ₹1,751`; mono keypad; primary CTA "Request from a friend" + secondary "Share a payment link".

---

## The signature element: rate-lock card
Appears on **Review, Success, and Transaction detail**. It is the one bold, memorable component — everything else stays neutral. Three approved variants (selectable; **default = Columns**):

- **Columns (default):** Left column — `YOU PAY` (mono micro-label) over `$5.71` (mono, ink). A 34px circular swap glyph in the middle. Right column, right-aligned — `MERCHANT GETS` (emerald micro-label) over `₹500` (mono, **emerald**). Hairline divider. Bottom row: emerald dot + "Rate locked" (left) and mono `1 USD = 87.55 INR` (right, `white-space: nowrap`).
- **Stacked:** vertical — `YOU PAY $5.71` → down-arrow chip → `MERCHANT GETS ₹500` (emerald, larger) → divider → locked row.
- **Receipt:** centered hero — `MERCHANT GETS` + big emerald `₹500` + muted `= $5.71 from your balance` → divider → centered locked row.

Card: white, 1px hairline, radius 20, soft + medium shadow (see tokens).

---

## Interactions & behavior
- **Navigation model:** two bottom-nav tabs (Home, Activity) form the base layer. Everything else is an overlay: **bottom sheets** (scan/amount/review/success/declined/add/send/send-amount/request) slide up over a scrim; **full screens** (detail, settings) slide in from the right. Tapping the scrim or × closes a sheet.
- **Entrance/exit motion:** sheets ~0.34s `cubic-bezier(.22,.7,.25,1)` rise+fade in, ~0.28s fade+drop out; full screens slide X. *(In a native app use the platform's standard sheet/navigation transitions.)*
- **Pay flow:** Pay nav button → Scan → tap merchant → **[first time only: just-in-time KYC sheet → "Verify identity"]** → Amount (keypad) → Review → "Pay ₹X" → **deduct USD from balance, prepend a transaction, show Success**. If `usd > balance`, show **Declined** instead and **do not** change the balance.
- **Onboarding flow:** first app launch → Welcome → Face ID → Choose handle → Add first dollars → Home (persisted via `localStorage 'pay.onboarded'`; replayable from Settings). **Recovery is deferred** — auto-prompted once after the first successful payment, never as an opening wall. **KYC is just-in-time** — asked only when the user first tries to pay a merchant.
- **Send flow:** Send tile → pick friend → amount → "Send $X" → deduct, prepend txn, show "Sent" confirmation.
- **Add flow:** Add tile → choose/enter amount → "Add $X" → increase balance, prepend a "+$X" top-up txn, close.
- **Keypads:** mono digits; `⌫` deletes; first leading `0` is replaced; reasonable max length. Money math: rupees ⇄ usd via `RATE`.
- **Disabled CTAs:** 0.4 opacity, non-interactive (e.g., Review at ₹0, Send above balance).
- **Copy voice:** plain, active, sentence case, end-user language. Buttons say exactly what happens ("Pay ₹500", "Send $12", "Add $100"); success repeats the verb ("Paid", "Sent"). No jargon, **no crypto words** anywhere user-visible. Errors state what happened, confirm the balance is safe, and give the fix — calmly, no apology.

## State management
Single screen-state controller (see `app.jsx`):
- `balanceUSD` (start 420) — source of truth; INR is always derived (`round(usd × 87.55)`).
- `tab` — `home | activity`.
- `sheet` — current overlay id (or null) + a `closing` flag for exit animation.
- `merchant`, `friend`, `payRupees`, `sendUsd` — in-flight transaction context.
- `onb` (onboarding step index or null), `kyc` (verified yet), `recovered`, `pendingPay` (KYC was triggered mid-pay) — drive the onboarding + just-in-time identity logic.
- `transactions[]` — `{ id, type: 'pay'|'send'|'add', title, time, usd, rupees? }`; new ones prepend.
- **Tweakable design decisions** (currently the three open product choices): `homeCur` (`INR` default / `USD` / `Flip`), `rateLockVariant` (`Columns` default / `Stacked` / `Receipt`), `accent` (`#0E7A63` default). Recommended defaults: **INR-forward, Columns, emerald.**

No backend in the prototype — balances and history are local state. In production these map to the wallet/ledger and payment-rail APIs.

## Onboarding & identity model (key product decisions)
The onboarding is built around **shortest path to first payment**, with two deliberate deferrals — replicate this behavior:
- **Recovery is deferred** to *after* the first payment (not an opening wall), because losing a device without recovery means losing money — but asking before any value is delivered hurts activation.
- **KYC (Tier 2) is just-in-time**, surfaced only when the user first tries to pay a merchant. Tier 1 (friends, up to $100/transfer) needs no KYC. This is the honest version of tiered limits — unlocked by verification, never by tokens/staking. **No crypto language anywhere.**

## Assets
- **Fonts:** Schibsted Grotesk, Inter, Spline Sans Mono — all Google Fonts (swap to your app's bundled equivalents).
- **Icons:** simple line/geometric SVGs defined inline in `ui.jsx` (plus, send/request arrows, chevron, QR, home, activity, swap, mail, search, copy, check, ×). Replace with your icon library.
- No raster images or logos — the "P" mark is a styled text square.

## Files in this bundle
- `Pay.html` — the **interactive prototype** (tap through every flow; toggle **Tweaks** in the toolbar to compare the three open decisions). Entry point.
- `Pay — Screens.html` — **flat overview** of all 19 screens laid out side by side (static map).
- `pay.css` — the complete **design system / spec** (tokens, components, layout). Primary visual reference.
- `ui.jsx` — shared icons, status bar, money formatters (`RATE`, `inr`, `usd`).
- `screens-core.jsx` — Home + pay flow + the `RateLock` component (3 variants).
- `screens-more.jsx` — Add money, Activity, Detail, Send, Send amount, Request, Settings.
- `screens-onboarding.jsx` — Welcome, Face ID, Handle, Fund, Recovery (deferred), Verify/KYC (just-in-time).
- `app.jsx` — the state controller, phone frame, router, nav, onboarding/identity logic, and Tweaks wiring.
- `Pay — Hi-fi calibration.html` — static 2-screen reference (Home + Review) at full fidelity.

> Tip: open `pay.css` and `Pay — Screens.html` side by side — the CSS gives you exact values, the overview shows you where each value lands.
