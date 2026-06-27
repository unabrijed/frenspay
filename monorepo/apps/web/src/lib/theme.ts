// theme.ts — WEB adapter over the shared design tokens (@pay/shared). The single source of
// truth lives in packages/shared/src/tokens.ts; this only renders those tokens as web CSS
// (font CSS-vars + numeric weights, box-shadow strings, px line-heights). Re-skin in @pay/shared.
import { colors, radii, shadowSpec, spacing, tile, typeScale, type FontRole, type ShadowKey, type ShadowSpec, type TypeSpec } from '@pay/shared';
import type { CSSProperties } from 'react';

export { colors, radii, tile };
export type { TileTone, TypeVariant } from '@pay/shared';

export const GUTTER = spacing.GUTTER;
export const SHEET_GUTTER = spacing.SHEET_GUTTER;

/* ---- fonts: role → CSS var + weight. All roles render Hanken Grotesk (one family);
   the `mono*` roles add tabular figures for aligned money columns. ---- */
const SANS = 'var(--font-sans)';
const TAB = { fontVariantNumeric: 'tabular-nums' } as const;
const F: Record<FontRole, CSSProperties> = {
  disp700: { fontFamily: SANS, fontWeight: 700 },
  disp800: { fontFamily: SANS, fontWeight: 800 },
  body400: { fontFamily: SANS, fontWeight: 400 },
  body500: { fontFamily: SANS, fontWeight: 500 },
  body600: { fontFamily: SANS, fontWeight: 600 },
  mono400: { fontFamily: SANS, fontWeight: 400, ...TAB },
  mono500: { fontFamily: SANS, fontWeight: 500, ...TAB },
  mono600: { fontFamily: SANS, fontWeight: 600, ...TAB },
};
/** Font family+weight tokens (e.g. `fonts.mono500`) for ad-hoc inline text styles. */
export const fonts = F;

/* ---- shadows: abstract spec → CSS box-shadow string ---- */
function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export const shadows = Object.fromEntries(
  (Object.entries(shadowSpec) as Array<[string, ShadowSpec]>).map(([k, s]) => {
    const drop = `${s.x}px ${s.y}px ${s.blur}px ${hexToRgba(s.color, s.opacity)}`;
    return [k, s.inset ? `${drop}, ${s.inset}` : drop];
  }),
) as Record<ShadowKey, string>;

/* ---- type scale: shared metrics + web font + px line-height ---- */
const UP = 'uppercase' as const;
export const type = Object.fromEntries(
  (Object.entries(typeScale) as Array<[string, TypeSpec]>).map(([k, t]) => [
    k,
    {
      ...F[t.role],
      fontSize: t.fontSize,
      ...(t.letterSpacing != null ? { letterSpacing: t.letterSpacing } : {}),
      ...(t.lineHeight != null ? { lineHeight: `${t.lineHeight}px` } : {}),
      ...(t.color ? { color: colors[t.color] } : {}),
      ...(t.upper ? { textTransform: UP } : {}),
    } as CSSProperties,
  ]),
) as Record<keyof typeof typeScale, CSSProperties>;
