// theme.ts — WEB adapter over the shared design tokens (@fpay/shared). The single source of
// truth lives in packages/shared/src/tokens.ts; this only renders those tokens as web CSS
// (font CSS-vars + numeric weights, box-shadow strings, px line-heights). Re-skin in @fpay/shared.
// Apps choose typography via CSS variables over the shared painting palette.
import { colors, radii, shadowSpec, spacing, tile, typeScale, type FontRole, type ShadowKey, type ShadowSpec, type TypeSpec } from '@fpay/shared';
import type { CSSProperties } from 'react';

export { colors, radii, tile };
export type { TileTone, TypeVariant } from '@fpay/shared';

export const GUTTER = spacing.GUTTER;
export const SHEET_GUTTER = spacing.SHEET_GUTTER;

/* Apps can supply display/body families independently; the LP console retains Spectral. */
const DISPLAY = 'var(--font-display, var(--font-spectral))';
const BODY = 'var(--font-body, var(--font-spectral))';
const MARK = 'var(--font-mono)';
const TAB = { fontVariantNumeric: 'tabular-nums' } as const;
const F: Record<FontRole, CSSProperties> = {
  disp700: { fontFamily: DISPLAY, fontWeight: 'var(--font-display-weight, 300)' as CSSProperties['fontWeight'] },
  disp800: { fontFamily: DISPLAY, fontWeight: 'var(--font-display-heavy-weight, var(--font-display-weight, 300))' as CSSProperties['fontWeight'] },
  body400: { fontFamily: BODY, fontWeight: 400 },
  body500: { fontFamily: BODY, fontWeight: 500 },
  body600: { fontFamily: BODY, fontWeight: 600 },
  mono400: { fontFamily: MARK, fontWeight: 400, ...TAB },
  mono500: { fontFamily: MARK, fontWeight: 500, ...TAB },
  mono600: { fontFamily: MARK, fontWeight: 600, ...TAB },
};
/** Font family+weight tokens (e.g. `fonts.mono500`) for ad-hoc inline text styles. */
export const fonts = F;

/* ---- shadows: abstract spec → a spreadable style (`...shadows.card`). An object rather than the
   bare box-shadow string so the native adapter can hand back RN shadow props under the same name. ---- */
function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export const shadows = Object.fromEntries(
  (Object.entries(shadowSpec) as Array<[string, ShadowSpec]>).map(([k, s]) => {
    const drop = `${s.x}px ${s.y}px ${s.blur}px ${hexToRgba(s.color, s.opacity)}`;
    return [k, { boxShadow: s.inset ? `${drop}, ${s.inset}` : drop }];
  }),
) as Record<ShadowKey, CSSProperties>;

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
