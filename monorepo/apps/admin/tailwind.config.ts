import type { Config } from 'tailwindcss';

// tsconfig path aliases don't apply to Tailwind's config loader — import tokens by relative path.
import { colors as tokens } from '../../packages/shared/src/tokens';

// Dense-workstation admin console. Colors come from the shared brand tokens so admin stays
// on-brand; the type scale is deliberately smaller/denser than the consumer apps.
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: tokens.canvas,
        surface: tokens.surface,
        'surface-low': tokens.surfaceLow,
        'surface-high': tokens.surfaceHigh,
        ink: tokens.ink,
        muted: tokens.muted,
        hair: tokens.hair,
        outline: tokens.outlineVariant,
        accent: tokens.accent,
        'accent-deep': tokens.accentDeep,
        'accent-soft': tokens.accentSoft,
        danger: tokens.danger,
        teal: tokens.secondary,
        'teal-soft': tokens.secondarySoft,
        'teal-on': tokens.onSecondary,
      },
      // Two faces and no third (frenspay v2): Spectral says, JetBrains Mono marks. `sans` keeps
      // its Tailwind name so every `font-sans` in src/ still resolves — it just renders the voice.
      fontFamily: {
        sans: ['var(--font-spectral)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
