import type { Config } from 'tailwindcss';

// Deliberately empty. This app does not style with Tailwind utilities — every
// component takes inline styles from lib/theme.ts, which renders the tokens in
// @fpay/shared, and the handful of classNames in src/ are chrome + keyframe hooks
// defined by hand in app/globals.css (.app-frame, .fp-logo*, .skeleton, .pulse-ring).
//
// What used to be here was a hand-mirrored copy of the token set, and mirroring is
// exactly how it rotted: it still carried the retired violet system (#6F4AEC ink
// #1B1430), radii that no longer matched, and font families pointing at
// --font-display / --font-inter, which this app stopped defining when it moved to
// Hanken Grotesk. Nothing consumed it, so nothing caught it. Reaching for a utility
// class here would have painted the old brand.
//
// Keep it empty. If utilities are ever wanted, import the tokens from
// packages/shared/src/tokens.ts by relative path the way apps/admin does — Tailwind's
// config loader ignores tsconfig aliases, but it will follow a relative import, and
// that stays honest.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {},
  plugins: [],
};

export default config;
