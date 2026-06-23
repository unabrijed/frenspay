import type { Config } from 'tailwindcss';

// Tailwind utilities mirror the SINGLE SOURCE OF TRUTH in packages/shared/src/tokens.ts
// (a CSS/Tailwind config can't import the TS token object directly). Most styling flows
// through lib/theme.ts (shared-backed) inline styles; keep these literals in sync if a token
// changes in @pay/shared. The component-facing tokens are already centralised — this is chrome only.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FFFFFF',
        surface: '#FFFFFF',
        ink: '#1B1430',
        muted: '#8B83A8',
        hair: '#ECEAF3',
        accent: '#6F4AEC',
        accentDeep: '#5B37D6',
        inkSoft: '#F3F1FB',
        accentSoft: '#ECE6FD',
        accentLine: 'rgba(111,74,236,0.30)',
        danger: '#E5484D',
        pos: '#0FA678',
        scrim: 'rgba(27,20,48,0.42)',
        grab: '#E6E3F0',
        amber: '#FFC53D',
        mint: '#13C29A',
        coral: '#FF6F61',
        amberSoft: '#FFF1CF',
        mintSoft: '#D7F7EE',
        coralSoft: '#FFE4DF',
      },
      borderRadius: {
        sheet: '34px', rlc: '24px', card: '22px', tile: '20px',
        field: '16px', row: '16px', chip: '14px', iconSq: '13px',
        iconSqSm: '12px', pill: '999px', logo: '11px', logoXl: '18px',
      },
      fontFamily: {
        disp: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-inter)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(42,30,80,0.05)',
        rlc: '0 10px 24px rgba(42,30,80,0.12)',
        sheet: '0 14px 30px rgba(42,30,80,0.16)',
        primaryBtn: '0 8px 18px rgba(111,74,236,0.40)',
        payBtn: '0 10px 22px rgba(111,74,236,0.50)',
        segPill: '0 1px 2px rgba(42,30,80,0.08)',
      },
      maxWidth: { phone: '430px' },
    },
  },
  plugins: [],
};

export default config;
