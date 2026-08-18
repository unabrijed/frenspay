# frenspay — the design system (v2)

**Source:** the four scene paintings in `apps/landing/public/scenes` — `play`, `stay`, `pay`,
`relay` — and the art-direction document Bridge derived from them by sampling their pixels and
measuring their horizons. Nothing below is invented; every value came out of a painting.

This **replaces** the warm Material-3 system (terracotta `#a6341f`, cream `#fff8f4`, Hanken
Grotesk), which replaced the violet / Baloo 2 one. The values here are the single source of
truth and are encoded in `packages/shared/src/tokens.ts`, then rendered per-platform by each
`lib/theme.ts`.

## The idea

The world comes first and the product reveals later. Two thirds of any frame is paper and sky,
the weight is carried by water and shadow, and terracotta is the only saturated thing that
exists — which is why it is always the subject.

## Colour

Thirteen values. Seed names in `brand`, roles in `colors` (`packages/shared/src/tokens.ts`).

### paper & sky — 55–80% of any frame
| hex | seed | role |
|---|---|---|
| `#fdf3dc` | `sun` | `surface` — cards, which sit lighter than the page |
| `#fce8cb` | `paper` | `canvas` — the page |
| `#fadba7` | `paperWarm` | `surfaceLow` |
| `#f8cba0` | `cloud` | `surfaceContainer`, `inkSoft` |
| `#f2b48c` | `cloudDeep` | `surfaceHigh`, `accentSoft` |
| `#dbb88b` | `sand` | `surfaceVariant`, `grab` |

### water & shadow
| hex | seed | role |
|---|---|---|
| `#718479` | `sage` | — |
| `#4e6d6a` | `water` | `secondary`, `secondarySoft`, `pos` |
| `#3a6467` | `waterDeep` | — |
| `#0e3d45` | `petrol` | display type over sky (landing) |
| `#2b3131` | `ink` | `ink`, `scrim`, `shadowBase` — the silhouette colour |

### the one accent — under 2% of any frame
| hex | seed | role |
|---|---|---|
| `#b94f2b` | `terracotta` | `accent` — fills and display type |
| `#8f3a1e` | `terracottaDeep` | `accentDeep` — accent as body-sized text, and pressed |
| `#e5813f` | `ember` | the accent's cut for dark surfaces |

**One rust event per frame: a kite, a scarf, a lit window, a route line, a button. Never two.**

### text neutrals and the two values that are not sampled
`muted #6b6156` (5.1:1) · `tertiary #726859` (4.6:1) · `outline #8a7a63` (3.5:1) ·
`outlineVariant #9c8a70` · `hair rgba(43,49,49,0.15)`.

Two deliberate exceptions, both in `tokens.ts` with the reasoning inline:
- `white #ffffff` is not a surface any more, but it is still the label on a terracotta fill —
  measured, white on terracotta is 4.98:1 where `sun` is 4.51:1, and the primary action of a
  money app is not where that margin gets spent on purity.
- `danger #ba1a1a` is not in the palette. Ember is the nearest thing in this world and reads as
  warmth, which is the opposite of what an error has to say.

### Contrast rules that changed a mapping
Terracotta is **4.2:1 on paper** — fine as a fill under white, fine as display type, and *not*
usable as body-sized text. Anywhere it is small text it is `accentDeep` instead.

The world contains **no pale teal**, and one is not invented: `secondarySoft` is the solid water
with paper on top (4.7:1) rather than a light container with dark text.

## Type — two faces, and no third

**Spectral** — the voice. Light (300) and Light Italic. Lowercase. Tight tracking on display
(`-0.018em` to `-0.022em`). Anything the brand says out loud.

**JetBrains Mono** — the system. Uppercase, 9–15px, tracked `.2`–`.28em`. Labels, act names,
counters, invite codes. It never speaks; it only marks.

- Never set brand copy in the mono.
- Never set a label in Spectral.
- No third face.

**ponytail:** body copy in the apps is Spectral **400**, not 300. The system specifies light
only, which is right for a headline over open sky and unreadable at 13–16px on a dense screen.
Display keeps 300. Revisit if the app's type ever gets bigger. The note lives in
`packages/ui/src/theme.ts` next to the mapping.

`FontRole` names (`disp700`, `body400`, `mono500`, …) are retained across re-skins so the adapter
machinery is unchanged — only what they render changes.

## Composition

Measured across the four paintings. These govern the artwork, the film and the socials.

- **Horizon 57–80%.** Never centred, never above half. It is the one line that must not move.
- **Figures as silhouette.** No faces, no outlines, no interior detail. Distant figures read at
  3% of frame height; the nearest, in `play`, at 15%.
- **Flat shape plus grain.** No line work, no gradients inside objects. Form comes from
  silhouette and value alone.
- **Water mirrors.** Anything standing in water repeats below it, softened and broken into
  horizontal dashes.

The site deliberately does **not** adopt the per-scene horizons. All four scenes are cropped to
one row (`--scene-hz: 75.97%` in the landing's `globals.css`) so the sea does not jump between
slides, and `apps/landing/scripts/check-scenes.mjs` asserts it. That is the horizon-lock rule
working, not a drift to correct.

## Surface

- **Paper grain** — uniform across the whole frame. Never localised, never animated.
- **Drybrush water** — horizontal streaks only, density rising toward the viewer.
- **Stippled cloud** — cloud edges break into dots; they never feather smoothly.
- **Broken reflection** — longer than the object, fading as it descends, never a clean mirror.

## Motion

In a frame this empty every moving thing is a decision. The film holds a painting and moves the
camera slowly inside it rather than cutting between shots.

| may move | may not move |
|---|---|
| the water surface · cloud drift · the single rust object · light on water · one figure | the horizon · the grain · the edges of shapes |

- Type enters **in the sky** — never over water, never on a scrim. The sky is already empty
  enough to hold it.
- Light is **painted, not lit**: warmth spreads as drybrush rings, never as a radial glow.
- Film spec: 4s before a push reads · 6px max horizon drift · 1 rust event per shot · 0 hard cuts.

## Voice

- **frens, never friends.** The misspelling is the whole membership signal. It is never corrected.
- **Short declaratives, full stops.** Three or four words, then a period. No exclamation marks,
  no questions.
- **Lowercase by default.** Capitals only where the existing copy already carries them.
- **No product words on the invitation.** No balance, wallet, forex, exchange rate, QR — those
  belong to the reveal. Enforced for `apps/landing` by `yarn check:copy`; inside the app those
  words are the correct ones.
- **No "merchant".** fpay is a software / IT service provider. Say "partner", or name the action
  ("scan and pay"). Enforced across web, lp, mobile and landing by the same check.

Reference lines: *things between frens* · *for people who know people — wherever they are.* ·
*play. stay. pay. relay.* · *What happens between frens stays between frens. mostly.*

## The invite

Three codes per person, shown once, in the mono at the size of the codes themselves. No resend,
no recovery, no reminder to screenshot — the mail carries them too, which is why the landing
persists nothing. The scarcity is the message: being invited means someone chose you.

## Shape, shadow, icons

Unchanged from the previous system — they were never the thing that was wrong.

- **Radii:** `card 20 · rlc 24 · tile 16 · field 12 · row 12 · sheet 28 · chip/pill 999`.
- **Shadows (tactile):** card `0 4px 20px` at 5% + a `0 1px 0` inner highlight · elevated
  `0 8px 30px` at 15% warm · primary button `0 4px 14px` at 20% terracotta. Bases are now `ink`
  and `#6b6156` rather than the old neutral greys.
- **Icons:** Material Symbols Outlined (FILL 0 default, FILL 1 for active).

## Where it lives

| File | What |
|---|---|
| `packages/shared/src/tokens.ts` | the source — seeds, roles, radii, shadows, type scale |
| `packages/ui/src/theme.ts` | web adapter — tokens → CSS |
| `apps/mobile/src/lib/theme.ts` | RN adapter — tokens → RN styles |
| `apps/landing/src/app/globals.css` | the landing's own `@theme` (Tailwind 4; web/lp are on 3, so it cannot share) |
| `apps/{web,lp}/src/app/globals.css` | a handful of `:root` vars mirrored by hand — CSS cannot import TS |
| `apps/admin/tailwind.config.ts` | imports the tokens by relative path |
| `brand/` | the mark, and `yarn brand` which emits every derived asset including the socials |
