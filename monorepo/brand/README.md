# Brand

**FrensPay** is the full name (landing header/footer, social card). **fpay** is the short name —
the app icon, `@fpay/*` package names, the `fpay://` scheme, and all in-app copy.

## The mark

Two frens: the dots are heads, and the curve rises at each end into a body beneath one of them, with
the dip as the space between them. Flat `#a6341f` (`brand.terracotta`).

**The f mark is retired.** It is gone from the tree — recover from git history if it is ever wanted
again — and nothing should reference `logo-mark.svg`.

## Source of truth — two shapes, one idea

| File | Ratio | Use |
| --- | --- | --- |
| `logo-lockup.svg` | 2.05:1 | headers and anything horizontal |
| `logo-icon.svg` | 1:1 | every square slot — favicon, app icon, avatar |

**Never feed the lockup into a square output.** Measured: at 16px it renders 13×6 and turns to mush,
and even at 96px it fills only 41% of a square tile. `generate.mjs` is arranged so square outputs can
only draw from `logo-icon.svg`.

The square is a *redraw, not a scale*, for a subtler reason worth keeping: in the lockup the curve's
ends sit directly **under** the dots, which is what makes each dot read as a head with a body. Pull
the dots together and the ends splay outward and the whole thing collapses into one heart-shaped
blob. So the icon cut keeps the ends under the dots and spends the square's height on a deeper dip —
two figures leaning together into a V. Legible to ~20px; soft but recognisable at 16px, which is
inherent to any two-element mark and not a fixable flaw.

**The wordmark is not a file.** It is live text — `frenspay`, Hanken Grotesk 700 — so it stays crisp
and recolourable. Consequently `logo-stacked.svg` carries live `<text>`: sharp has no access to
Hanken Grotesk, so no PNG output can typeset the wordmark, and outlining it would need the font file,
which is not in the repo. That is also why the social card is mark-only.

## Regenerating

```
yarn brand        # from monorepo/ — rewrites all 20 derived assets
```

Everything it lists is generated. Edit the two source SVGs, re-run, commit the outputs. Nothing at
build time depends on the script.

| Output | Spec |
| --- | --- |
| `apps/{landing,web,admin}/src/app/icon.svg` | 64² cream squircle, icon cut at 66% |
| `apps/{landing,web,admin}/src/app/apple-icon.png` | 180², full-bleed cream, icon cut |
| `apps/landing/public/logo-{lockup,icon,stacked}.svg` | bare, terracotta |
| `apps/landing/public/logo-{lockup,icon,stacked}-cream.svg` | for dark surfaces — the mobile foot is solid ink and the social card is terracotta, where the terracotta mark is nearly invisible |
| `apps/landing/src/app/opengraph-image.png` | 1200×630, cream icon cut on terracotta |
| `apps/landing/src/components/frenspay/logo-geometry.ts` | the lockup's numbers, for the animated inline React logo |
| `apps/mobile/assets/images/*` | 1024² icon / adaptive layers / splash, 48² web favicon |

66% matches the composition of the approved `src/icon-tile-1254.png`. Android's adaptive foreground
drops to 52% so the art survives a full circular mask.

### Why the geometry is emitted as TypeScript

The landing header renders the mark as **inline SVG**, not `<img>`, because the dots and the curve
animate independently and an `<img>` is one opaque box. Emitting `logo-geometry.ts` keeps `brand/*.svg`
the only place the shape is authored — otherwise the React component becomes a second copy that
silently diverges.

`apps/web/src/components/ui/primitives.tsx` inlines the icon-cut geometry by hand, because the apps
share no UI package. If the artwork changes, that one needs the same edit.

## `src/`

The original ChatGPT renders, kept for reference — noisy (thousands of near-identical shades) and
off-token, so nothing ships them directly. `src/reference/` holds three 3D "neon signage" mockups:
**never use these in the product**, they read as AI-generated, which the landing's design rules
explicitly cut.
