import type { Config } from 'tailwindcss';

// Deliberately empty, exactly as apps/web's is, and here for exactly one reason: `@tailwind base`
// in globals.css is the PREFLIGHT reset. @fpay/ui renders real <button> and <input> elements, so
// the two apps must give those components the same CSS environment or the shared design system
// looks subtly different in each — the kind of divergence nobody attributes to a missing reset.
//
// No utilities are used here either; styling comes from @fpay/ui's theme adapter over the tokens
// in @fpay/shared. If utilities are ever wanted, import the tokens by RELATIVE path the way
// apps/admin does — Tailwind's config loader ignores tsconfig aliases.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {},
  plugins: [],
};

export default config;
