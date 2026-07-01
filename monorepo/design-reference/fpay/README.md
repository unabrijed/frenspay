# fpay — canonical design system (FINAL, no going back)

Source: Google Stitch export (project `9482248058262328332`), 5 screens — Dashboard, Settling,
Transaction History, Payment Input, Choose Handle. This **replaces** the old violet "Direction 3" +
Baloo 2 system. The values below are the single source of truth; they are encoded in
`packages/shared/src/tokens.ts` (then rendered per-platform by each `lib/theme.ts`).

## Aesthetic
Warm Material-3 "Arrival" — cream surfaces, **terracotta** primary, **teal** secondary, soft **tactile**
shadows (a drop shadow plus an inner white highlight), rounded-2xl cards, pill buttons, an 8px grid.
Light mode. Brand wordmark: **fpay** (Hanken Grotesk, terracotta).

## Color (Material 3 roles → our semantic tokens)
| M3 role | hex | our token |
|---|---|---|
| primary | `#a6341f` | `accent` |
| surface-tint / pressed | `#aa3621` | `accentDeep` |
| primary-container | `#c84b34` | — |
| primary-fixed (soft) | `#ffdad3` | `accentSoft` |
| primary-fixed-dim | `#ffb4a5` | — |
| on-primary | `#ffffff` | `white` |
| secondary (teal) | `#416467` | `secondary` / `pos` (settled) |
| secondary-container | `#c1e7ea` | `secondarySoft` |
| on-secondary-container | `#294c4f` | `onSecondary` |
| surface | `#fff8f4` | `canvas` |
| surface-container-lowest | `#ffffff` | `surface` (cards) |
| surface-container-low | `#faf2ee` | `surfaceLow` |
| surface-container | `#f4ece8` | `surfaceContainer` / `inkSoft` |
| surface-container-high | `#eee7e2` | `surfaceHigh` |
| surface-variant | `#e8e1dd` | `surfaceVariant` / `hair` |
| on-surface | `#1e1b19` | `ink` |
| on-surface-variant | `#58413d` | `muted` |
| tertiary | `#5e5c59` | `tertiary` |
| outline | `#8c716c` | `outline` |
| outline-variant | `#e0bfb9` | `outlineVariant` |
| error | `#ba1a1a` | `danger` |
| inverse-surface | `#33302d` | — |

Shadow bases: `rgba(74,70,67,a)` = `#4a4643` (`shadowBase`); warm `rgba(140,113,108,a)` = `#8c716c`
(`shadowWarm`).

## Typography — Hanken Grotesk (one family, 400/500/600/700/800)
Numbers use **tabular** figures. Scale:
- display-lg `48/56` -0.02em 700 — big amounts / balance
- display-lg-mobile `32/40` -0.01em 700 — screen titles / onboarding H1 / success figure
- headline-md `24/32` 600 — section + sheet titles
- body-lg `18/28` 400 — emphasis body / row names
- body-md `16/24` 400 — body
- tabular-num `20/24` 500 — money figures
- label-sm `12/16` +0.05em 600 **UPPERCASE** — eyebrows / pills / tags

## Shape (radii)
cards rounded-2xl `16` · hero `24` · fields/rows rounded-xl `12` · buttons rounded-2xl `~16` ·
pills/chips/nav-active `full`. Tokens: `card 20, rlc 24, tile 16, field 12, row 12, chip 999, sheet 28`.

## Shadows (tactile)
- card: `0 4px 20px rgba(74,70,67,0.05)` + inset `0 1px 0 rgba(255,255,255,1)`
- hero/elevated card: `0 8px 30px rgba(140,113,108,0.15)`
- primary button: `0 4px 14px rgba(166,52,31,0.2)` + inset `0 1px 0 rgba(255,255,255,0.2)`
- bottom nav / sheet: `0 -4px 20px rgba(74,70,67,0.08)`

## Icons
**Material Symbols Outlined** (axis FILL 0 default, FILL 1 for active/emphasis; weight 400–600).

## Screen layouts (the 5 references)
1. **Dashboard** — top app bar (avatar · "fpay" wordmark · notifications); hero: an "Active in India"
   location pill, "Global Balance", a big tabular `$` amount; a primary CTA ("Pay Like a Local", scanner
   icon); a **bento** of cards (large USD wallet card, smaller INR card, dashed "Add" card); Recent Activity
   as rounded tactile rows (circular icon · name · time · amount).
2. **Settling** — centered success: pulsing terracotta rings around a white circle with a filled
   check_circle, "Merchant Paid" + "Settling in background" (sync icon), and a detail card (amount, rate
   guaranteed pill). Reused for our P2P "Sent" confirmation.
3. **Transaction History** — a trip-summary header card (big local figure + ≈USD + "Real-Rate" pill +
   Add Funds / Download buttons + faded map motif); **date-grouped** list (Today / Yesterday) where each
   row shows icon · merchant · **Settling / Settled** status · local amount + USD.
4. **Payment Input** — a white "Send Payment" canvas: recipient header, a big centered amount input with a
   currency chip, a real-rate "≈ $x USD" pill, a method row, and a primary Confirm button.
5. **Choose Handle** — centered "Choose your handle" + subtitle, an `@` field with an animated "Available"
   pill, "This cannot be changed later", primary Continue.

Map our P2P features into this language (we don't ship the merchant content — merchant stays dormant).
