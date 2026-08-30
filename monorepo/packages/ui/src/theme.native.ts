// theme.native.ts — the React Native adapter over the shared design tokens (@fpay/shared). Same
// exports and shapes as theme.ts (the web adapter) so shared components never know which one they
// got: `fonts.*` spread into a text style, `shadows.*` spread into a view style, `type.*` is a
// complete text style. Single source of truth stays packages/shared/src/tokens.ts.
import { colors, radii, shadowSpec, spacing, tile, typeScale, type FontRole, type ShadowKey, type TypeSpec } from '@fpay/shared';
import type { CSSProperties } from 'react';
import type { TextStyle, ViewStyle } from 'react-native';

// Typed as CSSProperties, like theme.ts, on purpose: shared components are written against one
// `St` and must typecheck ONCE. The values are RN style objects at runtime (sx() hands them to
// RN untouched); only the type lies, and it lies the same way the web's `var(--font)` does.

export { colors, radii, tile };
export type { TileTone, TypeVariant } from '@fpay/shared';

export const GUTTER = spacing.GUTTER;
export const SHEET_GUTTER = spacing.SHEET_GUTTER;

/* ---- fonts: role → RN family name (must match the keys loaded by the app's useFonts map).
   Spectral is the voice, JetBrains Mono only marks. Same ponytail note as the web adapter:
   body copy is Spectral 400, not the system's 300, which is unreadable at 13-16px. ---- */
const family = {
  disp700: 'Spectral_300Light',
  disp800: 'Spectral_300Light',
  body400: 'Spectral_400Regular',
  body500: 'Spectral_500Medium',
  body600: 'Spectral_600SemiBold',
  mono400: 'JetBrainsMono_400Regular',
  mono500: 'JetBrainsMono_500Medium',
  mono600: 'JetBrainsMono_600SemiBold',
} satisfies Record<FontRole, string>;
const TAB: TextStyle = { fontVariant: ['tabular-nums'] };
const fam = (k: FontRole, f: string): TextStyle => ({ fontFamily: f, ...(k.startsWith('mono') ? TAB : {}) });
/** Font family tokens (e.g. `fonts.mono500`) for ad-hoc inline text styles — spread them. */
export const fonts = Object.fromEntries(
  (Object.entries(family) as Array<[FontRole, string]>).map(([k, f]) => [k, fam(k, f)]),
) as unknown as Record<FontRole, CSSProperties>;

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
    } satisfies ViewStyle,
  ]),
) as unknown as Record<ShadowKey, CSSProperties>;

/* ---- type scale: shared metrics + RN font + numeric line-height ---- */
const UP = 'uppercase' as const;
export const type = Object.fromEntries(
  (Object.entries(typeScale) as Array<[string, TypeSpec]>).map(([k, t]) => [
    k,
    {
      ...fam(t.role, family[t.role]),
      fontSize: t.fontSize,
      ...(t.letterSpacing != null ? { letterSpacing: t.letterSpacing } : {}),
      ...(t.lineHeight != null ? { lineHeight: t.lineHeight } : {}),
      ...(t.color ? { color: colors[t.color] } : {}),
      ...(t.upper ? { textTransform: UP } : {}),
    },
  ]),
) as unknown as Record<keyof typeof typeScale, CSSProperties>;
