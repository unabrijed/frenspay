# Brand

**FrensPay** is the full name (landing header/footer, social card). **fpay** is the short name —
the app icon, `@fpay/*` package names, the `fpay://` scheme, and all in-app copy.

## Source of truth

`logo-mark.svg` — the f mark, traced from `src/lockup-stacked-light-1254.png` and snapped to the
brand tokens in `packages/shared/src/tokens.ts` (`#c84b34` terracottaContainer, `#ffdad3`
terracottaSoft). Coordinate system is 77.47 × 100.

**The wordmark is not a file.** It is live text — "Frens" at weight 800 + "Pay" at weight 400 in
Hanken Grotesk (`apps/landing/src/components/Logo.tsx`), so it stays crisp and recolourable.

## Regenerating

```
yarn brand        # from monorepo/ — rewrites all 14 derived assets
```

Everything under `apps/*` listed by that command is generated. Edit `logo-mark.svg`, re-run, commit
the outputs. Nothing at build time depends on the script.

| Output | Scale |
| --- | --- |
| `apps/{landing,web,admin}/src/app/icon.svg` | 64² cream squircle, mark at 66% |
| `apps/{landing,web,admin}/src/app/apple-icon.png` | 180², full-bleed cream |
| `apps/landing/public/logo-mark.svg` | bare mark, for the header lockup |
| `apps/landing/src/app/opengraph-image.png` | 1200×630, from the reversed lockup render |
| `apps/mobile/assets/images/*` | 1024² icon / adaptive layers / splash, 48² web favicon |

66% matches the composition of the approved `src/icon-tile-1254.png`. Android's adaptive foreground
drops to 52% so the art survives a full circular mask.

## `src/`

The original ChatGPT renders, kept for reference — noisy (thousands of near-identical shades) and
off-token, so nothing ships them directly except the social card. `src/reference/` holds three 3D
"neon signage" mockups: **never use these in the product**, they read as AI-generated, which the
landing's design rules explicitly cut.
