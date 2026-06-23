// tokens.ts — the SINGLE SOURCE OF TRUTH for design tokens, shared by web + mobile.
// Pure data only (no react / react-native imports) so it's safe in every bundle, including
// the backend. Platform-agnostic values live here; each app's lib/theme.ts is a thin adapter
// that turns these into platform representations (web CSS vs RN styles). Re-skin = edit here.

/* ---- Tier 1: brand seeds (change these to re-skin everything) ---- */
export const brand = {
  violet: '#6F4AEC', // Grape Soda — the brand colour
  violetDeep: '#5B37D6',
  violetSoft: '#ECE6FD',
  ink: '#1B1430',
  canvas: '#FFFFFF',
  white: '#FFFFFF',
  // playful colour family — flat tile / category colours
  amber: '#FFC53D',
  mint: '#13C29A',
  coral: '#FF6F61',
  amberSoft: '#FFF1CF',
  mintSoft: '#D7F7EE',
  coralSoft: '#FFE4DF',
  pos: '#0FA678', // money-positive green
  danger: '#E5484D',
} as const;

/* ---- Tier 2: semantic colour roles (apps import these via lib/theme) ---- */
export const colors = {
  canvas: brand.canvas,
  surface: '#FFFFFF',
  ink: brand.ink,
  muted: '#8B83A8',
  hair: '#ECEAF3',
  accent: brand.violet,
  accentDeep: brand.violetDeep,
  inkSoft: '#F3F1FB',
  accentSoft: brand.violetSoft,
  accentLine: 'rgba(111,74,236,0.30)',
  danger: brand.danger,
  pos: brand.pos,
  scrim: 'rgba(27,20,48,0.42)',
  grab: '#E6E3F0',
  white: '#FFFFFF',
  shadowBase: '#2A1E50',
  amber: brand.amber,
  mint: brand.mint,
  coral: brand.coral,
  amberSoft: brand.amberSoft,
  mintSoft: brand.mintSoft,
  coralSoft: brand.coralSoft,
} as const;

export type ColorKey = keyof typeof colors;

/* ---- Tier 3: component tokens ---- */
// Flat-colour action tiles (Home: Add / Send / Request).
export const tile = {
  add: { bg: brand.amber, fg: '#5A4300' },
  send: { bg: brand.mint, fg: '#FFFFFF' },
  request: { bg: brand.coral, fg: '#FFFFFF' },
} as const;
export type TileTone = keyof typeof tile;

/* ---- shape ---- */
export const radii = {
  sheet: 34, rlc: 24, card: 22, tile: 20, field: 16, row: 16,
  chip: 14, iconSq: 13, iconSqSm: 12, pill: 999, logo: 11, logoXl: 18,
} as const;

export const spacing = { GUTTER: 20, SHEET_GUTTER: 22 } as const;

/* ---- shadows (abstract spec; each platform renders CSS string vs RN object) ---- */
export interface ShadowSpec {
  color: string;
  opacity: number;
  x: number;
  y: number;
  blur: number;
  elevation: number; // Android
}
export const shadowSpec = {
  card: { color: colors.shadowBase, opacity: 0.05, x: 0, y: 1, blur: 2, elevation: 1 },
  rlc: { color: colors.shadowBase, opacity: 0.12, x: 0, y: 10, blur: 24, elevation: 8 },
  sheet: { color: colors.shadowBase, opacity: 0.16, x: 0, y: -10, blur: 30, elevation: 24 },
  primaryBtn: { color: brand.violet, opacity: 0.4, x: 0, y: 8, blur: 18, elevation: 8 }, // violet halo
  payBtn: { color: brand.violet, opacity: 0.5, x: 0, y: 10, blur: 22, elevation: 10 }, // violet halo
  segPill: { color: colors.shadowBase, opacity: 0.08, x: 0, y: 1, blur: 2, elevation: 2 },
} satisfies Record<string, ShadowSpec>;
export type ShadowKey = keyof typeof shadowSpec;

/* ---- type scale (metrics only; apps apply the platform font family) ---- */
export type FontRole =
  | 'disp700' | 'disp800'
  | 'body400' | 'body500' | 'body600'
  | 'mono400' | 'mono500' | 'mono600';

export interface TypeSpec {
  role: FontRole;
  fontSize: number;
  letterSpacing?: number;
  lineHeight?: number; // unit-less; web adapter appends 'px'
  color?: ColorKey;
  upper?: boolean; // textTransform: uppercase
}

export const typeScale = {
  // display (Baloo 2)
  heroBalance: { role: 'disp800', fontSize: 52, letterSpacing: -0.5, lineHeight: 53, color: 'ink' },
  bigAmount: { role: 'disp800', fontSize: 56, letterSpacing: -0.6, color: 'ink' },
  result: { role: 'disp700', fontSize: 26, letterSpacing: -0.2, color: 'ink' },
  screenTitle: { role: 'disp700', fontSize: 24, letterSpacing: -0.2, color: 'ink' },
  sheetTitle: { role: 'disp700', fontSize: 21, letterSpacing: -0.15, color: 'ink' },
  flipFig: { role: 'disp700', fontSize: 27, letterSpacing: -0.3, color: 'ink' },
  payeeWho: { role: 'disp700', fontSize: 19, color: 'ink' },
  brandWord: { role: 'disp700', fontSize: 19, letterSpacing: -0.15, color: 'ink' },
  logo: { role: 'disp700', fontSize: 17, color: 'white' },
  logoXl: { role: 'disp800', fontSize: 30, color: 'white' },
  tierTitle: { role: 'disp700', fontSize: 18, color: 'ink' },
  onbH1: { role: 'disp700', fontSize: 28, letterSpacing: -0.3, lineHeight: 31, color: 'ink' },
  avatarInitial: { role: 'disp700', fontSize: 16, color: 'ink' },
  profileAvatar: { role: 'disp700', fontSize: 20, color: 'ink' },

  // mono (Spline Sans Mono — money/handles/timestamps)
  rlcFigA: { role: 'mono500', fontSize: 25, letterSpacing: -0.25, color: 'ink' },
  rlcFigB: { role: 'mono500', fontSize: 24, letterSpacing: -0.24, color: 'ink' },
  rlcFigBg: { role: 'mono500', fontSize: 30, letterSpacing: -0.3, color: 'ink' },
  rlcFigC: { role: 'mono500', fontSize: 38, letterSpacing: -0.38, color: 'ink' },
  rlcMicro: { role: 'mono500', fontSize: 10.5, letterSpacing: 0.84, upper: true, color: 'muted' },
  eyebrow: { role: 'mono500', fontSize: 11, letterSpacing: 1.43, upper: true, color: 'muted' },
  dayLabel: { role: 'mono500', fontSize: 11, letterSpacing: 1.1, upper: true, color: 'muted' },
  tierTag: { role: 'mono600', fontSize: 11, letterSpacing: 0.88, upper: true, color: 'ink' },
  rowAmount: { role: 'mono500', fontSize: 15, color: 'ink' },
  rowTime: { role: 'mono400', fontSize: 12, color: 'muted' },
  sub: { role: 'mono400', fontSize: 14, color: 'muted' },
  conv: { role: 'mono400', fontSize: 15, color: 'muted' },
  rateLine: { role: 'mono400', fontSize: 12.5, color: 'muted' },
  keypad: { role: 'mono500', fontSize: 24, color: 'ink' },
  keypadFn: { role: 'mono500', fontSize: 20, color: 'muted' },
  chip: { role: 'mono500', fontSize: 15, color: 'ink' },
  fieldText: { role: 'mono400', fontSize: 16, color: 'ink' },
  handle: { role: 'mono400', fontSize: 16, color: 'ink' },
  monoSmall: { role: 'mono400', fontSize: 12, color: 'muted' },
  version: { role: 'mono400', fontSize: 12, color: 'muted' },

  // body (Inter)
  rowName: { role: 'body500', fontSize: 15, letterSpacing: -0.075, color: 'ink' },
  lead: { role: 'body400', fontSize: 14.5, lineHeight: 22, color: 'muted' },
  leadInk: { role: 'body400', fontSize: 15, lineHeight: 22, color: 'muted' },
  note: { role: 'body400', fontSize: 13, lineHeight: 19, color: 'muted' },
  caption: { role: 'body400', fontSize: 13, color: 'muted' },
  button: { role: 'body600', fontSize: 16.5, letterSpacing: -0.165 },
  buttonSm: { role: 'body600', fontSize: 15, letterSpacing: -0.15 },
  textlink: { role: 'body500', fontSize: 14.5, color: 'muted' },
  tabLabel: { role: 'body500', fontSize: 11 },
  tileLabel: { role: 'body500', fontSize: 13.5, color: 'ink' },
  filter: { role: 'body500', fontSize: 13, color: 'ink' },
  seeAll: { role: 'body500', fontSize: 13, color: 'accent' },
  kvKey: { role: 'body400', fontSize: 14, color: 'muted' },
  searchPh: { role: 'body400', fontSize: 14.5, color: 'muted' },
  tierDesc: { role: 'body400', fontSize: 14, lineHeight: 20, color: 'muted' },
  reassure: { role: 'body400', fontSize: 14.5, lineHeight: 22, color: 'muted' },
  inst: { role: 'body400', fontSize: 14, color: 'muted' },
  profileSub: { role: 'body400', fontSize: 14, color: 'muted' },
} satisfies Record<string, TypeSpec>;

export type TypeVariant = keyof typeof typeScale;
