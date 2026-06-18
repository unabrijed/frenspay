# Figma handoff — "Pay" travel payments app

**Figma file:** https://www.figma.com/design/9XYRvCQMk35tSy7On144Pl
**Source of truth for visuals:** this `design-reference/` folder — open `Pay - Screens.html` (flat map of all 19 screens) and `Pay.html` (interactive prototype) next to `pay.css` (exact values). Full spec: `README.md`.

## Why the file is partial
The file was generated via the Figma MCP on a **free Starter plan**, which has two hard limits:
- **3 pages per file** → the file is organized as **Foundations / Components / Screens** (not one page per group).
- **A low monthly MCP tool-call cap** (write calls count too). It was exhausted after building the foundation + a first slice of components, so the 19 screens and most components are **not yet built**.

What exists is the **highest-leverage layer**: the complete design-token system, type ramp, shadows, icons, and the Button. A designer can assemble every screen natively on top of it. Finishing via MCP just needs a paid Full/Dev seat (or waiting for the monthly reset).

---

## ✅ What's already in the file (use these — don't recreate)

### Variables (Foundations → local variables)
All carry proper scopes + WEB `var()` code syntax, so Dev Mode shows the CSS variable name.

| Collection | Tokens |
|---|---|
| **Color** | `color/canvas` #F5F6F4 · `surface` #FFFFFF · `ink` #16181C · `muted` #8A8E94 · `hair` #EAEBE8 · `accent` #0E7A63 · `ink-soft` #F1F2EF · `accent-soft` #E4F2EC · `scrim` rgba(16,18,20,.42) |
| **Radius** | `radius/device` 48 · `sheet` 30 · `rate-lock` 20 · `card` 18 · `tile` 16 · `field` 14 · `row` 14 · `icon` 10 · `pill` 999 |
| **Spacing** | `spacing/gutter` 20 + scale 2,4,6,8,10,12,13,14,16,18,22,24,26 |

### Text styles
- **Display/** (Schibsted Grotesk): `Hero balance` 52/800 · `Amount entry` 56/800 · `Result` 26/700 · `Screen title` 24/700 · `Sheet title` 21/700 · `Welcome H1` 32/700 · `Onboarding H1` 28/700 · `Flip figure` 27/700 · `Wordmark` 19/700 · `Logo XL` 30 · `Logo` 17 · `Avatar` 20
- **Mono/** (Spline Sans Mono): `Rate big` 38 · `Fig 30` · `Fig 25` · `Fig 24` · `Keypad` 24 · `Handle` 16 · `Status` 15 · `Amount` 15 · `Sub` 14 · `Time` 12 · `Eyebrow` 11 UPPER · `Micro` 10.5 UPPER
- **Body/** (Inter): `Button` 16.5/600 · `Row name` 15/500 · `Text link` 14.5 · `Lead` 14.5 · `Desc` 14 · `Tile label` 13.5 · `Caption` 13 · `Nav label` 11

> **Brand rule:** every money figure, rate, @handle, timestamp, and reference uses a **Mono/** style. Never set money in Body.

### Effect styles
`shadow/card` · `shadow/rate-lock` (dual) · `shadow/sheet` · `shadow/button-primary` (emerald glow) · `shadow/pay-nav` (glow + inset) · `shadow/device`

### Components (Components page)
- **Icons** (19): `icon/plus, send, request, chevron, back, close, home, activity, swap, mail, device, search, copy, lockcheck, face, qr, qrbig, check, xbig` — vectors, recolor per use (accent for merchant QR, white for the pay-nav qrbig, etc.).
- **Button** — variant set: `Style = Primary | Ink | Secondary`, `State = Default | Disabled`. Height 54, pill radius, `shadow/button-primary` on Primary.

---

## ⏳ What still needs building

**Components to add** (atoms → molecules, bind every fill/stroke/radius/gap to the variables above):
Chip (Default/Selected) · Field · Segmented toggle (INR|USD) · Filter pill (Default/Selected) · Tile (Add/Send/Request) · List card container · **Transaction row** (Type = pay/send/add) · Key-value row · **Rate-lock card** (the signature element — `Layout = Columns | Stacked | Receipt`) · Keypad · Result badge (ok/no) · Tier card (Active/Locked) · Avatar · Friend avatar · Logo · Status bar · Bottom nav (Pay button lifted 22px) · Sheet header (grab + title + ×) · Full-screen header (back chevron) · Device frame (390×844, `radius/device`).

> **Spec for each** is in `pay.css` (search the class — `.rlc.A/.B/.C` = the 3 rate-lock variants, `.row` = transaction row, `.nav` = bottom nav, `.keypad`, `.chip`, `.tier`, etc.) and `README.md` ("Design tokens", "Global chrome", "The signature element: rate-lock card").

**The 19 screens** (Screens page) — each a 390×844 frame = Status bar (52) + content + (Home/Activity only) Bottom nav (86). Defaults: **INR-forward Home, Columns rate-lock, emerald accent**. Constant: `1 USD = 87.55 INR`, balance `$420 / ₹36,771`.

| Group | Screens | Key pieces (from README + the .jsx files) |
|---|---|---|
| Onboarding | Welcome · Face ID · Choose handle · Add first dollars · Recovery (sheet) · Verify/KYC (sheet) | `screens-onboarding.jsx` |
| Core | Home · Activity | `screens-core.jsx` (Home), `screens-more.jsx` (Activity) |
| Pay flow | Scan · Amount · Review · Success · Declined | `screens-core.jsx` |
| Money & friends | Add money · Send (pick friend) · Send amount · Request · Transaction detail · Settings | `screens-more.jsx` |

Build order that minimizes rework: finish the **components** first (especially Transaction row + Rate-lock card + Bottom nav + Sheet header), then compose screens from instances. The `.jsx` files give exact structure/copy; `pay.css` gives exact values.

## To finish via the MCP later
Upgrade the Figma account to a **Full/Dev seat** (or wait for the monthly tool-call reset), then resume: components → screens, validating with occasional screenshots. The token/style foundation above is reused as-is — no rework needed.
