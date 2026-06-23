// theme.ts — MOBILE (React Native) adapter over the shared design tokens (@pay/shared).
// Single source of truth: packages/shared/src/tokens.ts. This renders those tokens as RN
// styles (font-family names, RN shadow objects, numeric line-heights). Re-skin in @pay/shared.
import { colors, radii, shadowSpec, spacing, tile, typeScale, type FontRole, type ShadowKey, type TypeSpec } from '@pay/shared';
import type { TextStyle, ViewStyle } from 'react-native';

export { colors, radii, tile };
export type { TileTone, TypeVariant } from '@pay/shared';

export const GUTTER = spacing.GUTTER;
export const SHEET_GUTTER = spacing.SHEET_GUTTER;

/* ---- fonts: role → RN family name (must match the keys loaded in lib/fonts.ts) ---- */
export const fonts = {
  disp700: 'Baloo2_700Bold',
  disp800: 'Baloo2_800ExtraBold',
  body400: 'Inter_300Light',
  body500: 'Inter_400Regular',
  body600: 'Inter_500Medium',
  mono400: 'SplineSansMono_300Light',
  mono500: 'SplineSansMono_400Regular',
  mono600: 'SplineSansMono_500Medium',
} satisfies Record<FontRole, string>;

/* ---- shadows: abstract spec → RN shadow object (+ Android elevation) ---- */
export const shadows = Object.fromEntries(
  Object.entries(shadowSpec).map(([k, s]) => [
    k,
    {
      shadowColor: s.color,
      shadowOpacity: s.opacity,
      shadowRadius: s.blur,
      shadowOffset: { width: s.x, height: s.y },
      elevation: s.elevation,
    },
  ]),
) as Record<ShadowKey, ViewStyle>;

/* ---- type scale: shared metrics + RN font + numeric line-height ---- */
const UP = 'uppercase' as const;
export const type = Object.fromEntries(
  (Object.entries(typeScale) as Array<[string, TypeSpec]>).map(([k, t]) => [
    k,
    {
      fontFamily: fonts[t.role],
      fontSize: t.fontSize,
      ...(t.letterSpacing != null ? { letterSpacing: t.letterSpacing } : {}),
      ...(t.lineHeight != null ? { lineHeight: t.lineHeight } : {}),
      ...(t.color ? { color: colors[t.color] } : {}),
      ...(t.upper ? { textTransform: UP } : {}),
    } as TextStyle,
  ]),
) as Record<keyof typeof typeScale, TextStyle>;
