// theme.ts — WEB adapter over the shared design tokens (@pay/shared). The single source of
// truth lives in packages/shared/src/tokens.ts; this only renders those tokens as web CSS
// (font CSS-vars + numeric weights, box-shadow strings, px line-heights). Re-skin in @pay/shared.
import { colors, radii, shadowSpec, spacing, tile, typeScale, type FontRole, type ShadowKey, type TypeSpec } from '@pay/shared';
import type { CSSProperties } from 'react';

export { colors, radii, tile };
export type { TileTone, TypeVariant } from '@pay/shared';

export const GUTTER = spacing.GUTTER;
export const SHEET_GUTTER = spacing.SHEET_GUTTER;

/* ---- fonts: role → CSS var + weight (mirrors lib/fonts.ts) ---- */
const F: Record<FontRole, CSSProperties> = {
  disp700: { fontFamily: 'var(--font-display)', fontWeight: 700 },
  disp800: { fontFamily: 'var(--font-display)', fontWeight: 800 },
  body400: { fontFamily: 'var(--font-inter)', fontWeight: 300 }, // Inter Light
  body500: { fontFamily: 'var(--font-inter)', fontWeight: 400 }, // Inter Regular
  body600: { fontFamily: 'var(--font-inter)', fontWeight: 500 }, // Inter Medium
  mono400: { fontFamily: 'var(--font-mono)', fontWeight: 300 },
  mono500: { fontFamily: 'var(--font-mono)', fontWeight: 400 },
  mono600: { fontFamily: 'var(--font-mono)', fontWeight: 500 },
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
  Object.entries(shadowSpec).map(([k, s]) => [k, `${s.x}px ${s.y}px ${s.blur}px ${hexToRgba(s.color, s.opacity)}`]),
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
