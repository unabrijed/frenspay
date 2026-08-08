// tokens.ts — the SINGLE SOURCE OF TRUTH for design tokens, shared by web + mobile.
// Pure data only (no react / react-native imports) so it's safe in every bundle, including
// the backend. Platform-agnostic values live here; each app's lib/theme.ts is a thin adapter
// that turns these into platform representations (web CSS vs RN styles). Re-skin = edit here.
//
// THEME: "fpay" — warm Material-3. Terracotta primary, teal secondary, cream surfaces,
// Hanken Grotesk, tactile shadows. (Supersedes the old violet / Baloo 2 system.)

/* ---- Tier 1: brand seeds (change these to re-skin everything) ---- */
export const brand = {
  terracotta: '#a6341f', // primary — the brand colour
  terracottaDeep: '#aa3621', // surface-tint / pressed
  terracottaContainer: '#c84b34',
  terracottaSoft: '#ffdad3', // primary-fixed
  terracottaSoftDim: '#ffb4a5', // primary-fixed-dim
  teal: '#416467', // secondary
  tealContainer: '#c1e7ea',
  onTealContainer: '#294c4f',
  ink: '#1e1b19', // on-surface
  canvas: '#fff8f4', // surface (warm cream)
  white: '#ffffff',
  error: '#ba1a1a',
} as const;

/* ---- Tier 2: semantic colour roles (apps import these via lib/theme) ---- */
export const colors = {
  canvas: brand.canvas, // page background (warm cream)
  surface: '#ffffff', // cards (container-lowest)
  surfaceLow: '#faf2ee', // container-low
  surfaceContainer: '#f4ece8', // container
  surfaceHigh: '#eee7e2', // container-high
  surfaceVariant: '#e8e1dd',
  ink: brand.ink, // primary text
  muted: '#58413d', // on-surface-variant (secondary text)
  tertiary: '#5e5c59',
  hair: '#e8e1dd', // dividers (surface-variant)
  outline: '#8c716c',
  outlineVariant: '#e0bfb9', // borders
  accent: brand.terracotta,
  accentDeep: brand.terracottaDeep,
  accentSoft: brand.terracottaSoft,
  accentLine: 'rgba(166,52,31,0.30)',
  inkSoft: '#f4ece8', // neutral pressed / chip fill (container)
  secondary: brand.teal,
  secondarySoft: brand.tealContainer,
  onSecondary: brand.onTealContainer,
  danger: brand.error,
  pos: brand.teal, // money-positive / settled (teal)
  scrim: 'rgba(30,27,25,0.42)',
  grab: '#e0d9d4',
  white: '#ffffff',
  shadowBase: '#4a4643', // rgba(74,70,67) — neutral tactile shadow
  shadowWarm: '#8c716c', // rgba(140,113,108) — warm elevated shadow
  // legacy category keys (kept so existing call sites compile) → mapped on-brand
  amber: '#8c716c',
  mint: brand.teal,
  coral: brand.terracotta,
  amberSoft: '#f4ece8',
  mintSoft: brand.tealContainer,
  coralSoft: brand.terracottaSoft,
} as const;

export type ColorKey = keyof typeof colors;

/* ---- Tier 3: component tokens ---- */
// Flat-colour action tiles (Home: Add / Send / Request).
export const tile = {
  add: { bg: brand.terracottaSoft, fg: '#891e0b' }, // peach / on-primary-fixed-variant
  send: { bg: brand.terracotta, fg: '#ffffff' }, // primary
  request: { bg: brand.tealContainer, fg: brand.onTealContainer }, // teal
} as const;
export type TileTone = keyof typeof tile;

/* ---- shape ---- */
export const radii = {
  sheet: 28, rlc: 24, card: 20, tile: 16, field: 12, row: 12,
  chip: 999, iconSq: 12, iconSqSm: 10, pill: 999, logo: 12, logoXl: 16,
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
  inset?: string; // optional inner highlight (web only), e.g. 'inset 0 1px 0 rgba(255,255,255,1)'
}
export const shadowSpec = {
  card: { color: colors.shadowBase, opacity: 0.05, x: 0, y: 4, blur: 20, elevation: 2, inset: 'inset 0 1px 0 rgba(255,255,255,1)' },
  rlc: { color: colors.shadowWarm, opacity: 0.15, x: 0, y: 8, blur: 30, elevation: 8 },
  sheet: { color: colors.shadowBase, opacity: 0.1, x: 0, y: -4, blur: 20, elevation: 24 },
  primaryBtn: { color: brand.terracotta, opacity: 0.2, x: 0, y: 4, blur: 14, elevation: 6, inset: 'inset 0 1px 0 rgba(255,255,255,0.2)' },
  payBtn: { color: brand.terracotta, opacity: 0.28, x: 0, y: 6, blur: 18, elevation: 8, inset: 'inset 0 1px 0 rgba(255,255,255,0.3)' },
  segPill: { color: colors.shadowBase, opacity: 0.05, x: 0, y: 2, blur: 8, elevation: 2 },
} satisfies Record<string, ShadowSpec>;
export type ShadowKey = keyof typeof shadowSpec;

/* ---- type scale (metrics only; apps apply the platform font — all Hanken Grotesk) ---- */
// FontRole names are retained from the previous system so the adapter machinery is unchanged;
// every role now maps to Hanken Grotesk (the `mono*` roles additionally render tabular figures).
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
  // display (Hanken Grotesk 700/800)
  heroBalance: { role: 'disp700', fontSize: 48, letterSpacing: -1, lineHeight: 56, color: 'ink' },
  bigAmount: { role: 'disp700', fontSize: 48, letterSpacing: -1, color: 'ink' },
  result: { role: 'disp700', fontSize: 32, letterSpacing: -0.4, lineHeight: 40, color: 'ink' },
  screenTitle: { role: 'disp700', fontSize: 24, letterSpacing: -0.2, color: 'ink' },
  sheetTitle: { role: 'disp700', fontSize: 24, letterSpacing: -0.2, color: 'ink' },
  flipFig: { role: 'disp700', fontSize: 27, letterSpacing: -0.3, color: 'ink' },
  payeeWho: { role: 'disp700', fontSize: 20, color: 'ink' },
  brandWord: { role: 'disp700', fontSize: 26, letterSpacing: -0.5, color: 'accent' }, // fpay wordmark
  // (No `logo`/`logoXl` text roles: the logo is artwork, not a glyph. They set the
  // single letter that stood in for the mark before it existed. `radii.logo` and
  // `radii.logoXl` remain — those are the tile's corner radii.)
  tierTitle: { role: 'disp700', fontSize: 18, color: 'ink' },
  onbH1: { role: 'disp700', fontSize: 32, letterSpacing: -0.3, lineHeight: 40, color: 'ink' },
  avatarInitial: { role: 'disp700', fontSize: 16, color: 'ink' },
  profileAvatar: { role: 'disp700', fontSize: 20, color: 'ink' },

  // mono → Hanken Grotesk with tabular figures (money / handles / timestamps)
  rlcFigA: { role: 'mono500', fontSize: 25, letterSpacing: -0.25, color: 'ink' },
  rlcFigB: { role: 'mono500', fontSize: 24, letterSpacing: -0.24, color: 'ink' },
  rlcFigBg: { role: 'mono500', fontSize: 30, letterSpacing: -0.3, color: 'ink' },
  rlcFigC: { role: 'mono500', fontSize: 38, letterSpacing: -0.38, color: 'ink' },
  rlcMicro: { role: 'mono600', fontSize: 11, letterSpacing: 0.55, upper: true, color: 'muted' },
  eyebrow: { role: 'mono600', fontSize: 12, letterSpacing: 0.6, upper: true, color: 'muted' },
  dayLabel: { role: 'mono600', fontSize: 12, letterSpacing: 0.6, upper: true, color: 'muted' },
  tierTag: { role: 'mono600', fontSize: 12, letterSpacing: 0.5, upper: true, color: 'ink' },
  rowAmount: { role: 'mono500', fontSize: 16, color: 'ink' },
  rowTime: { role: 'mono400', fontSize: 13, color: 'muted' },
  sub: { role: 'mono400', fontSize: 14, color: 'muted' },
  conv: { role: 'mono400', fontSize: 15, color: 'muted' },
  rateLine: { role: 'mono400', fontSize: 12.5, color: 'muted' },
  keypad: { role: 'mono500', fontSize: 24, color: 'ink' },
  keypadFn: { role: 'mono500', fontSize: 20, color: 'muted' },
  chip: { role: 'mono500', fontSize: 15, color: 'ink' },
  fieldText: { role: 'mono400', fontSize: 16, color: 'ink' },
  handle: { role: 'mono500', fontSize: 16, color: 'ink' },
  monoSmall: { role: 'mono400', fontSize: 12, color: 'muted' },
  version: { role: 'mono400', fontSize: 12, color: 'muted' },

  // body (Hanken Grotesk 400/500/600)
  rowName: { role: 'body500', fontSize: 16, letterSpacing: -0.075, color: 'ink' },
  lead: { role: 'body400', fontSize: 15, lineHeight: 23, color: 'muted' },
  leadInk: { role: 'body400', fontSize: 16, lineHeight: 24, color: 'muted' },
  note: { role: 'body400', fontSize: 13, lineHeight: 19, color: 'muted' },
  caption: { role: 'body400', fontSize: 13, color: 'muted' },
  button: { role: 'body600', fontSize: 16.5, letterSpacing: -0.165 },
  buttonSm: { role: 'body600', fontSize: 15, letterSpacing: -0.15 },
  textlink: { role: 'body500', fontSize: 14.5, color: 'muted' },
  tabLabel: { role: 'body600', fontSize: 12 },
  tileLabel: { role: 'body500', fontSize: 13.5, color: 'ink' },
  filter: { role: 'body500', fontSize: 13, color: 'ink' },
  seeAll: { role: 'body600', fontSize: 13, color: 'accent' },
  kvKey: { role: 'body400', fontSize: 14, color: 'muted' },
  searchPh: { role: 'body400', fontSize: 15, color: 'muted' },
  tierDesc: { role: 'body400', fontSize: 14, lineHeight: 20, color: 'muted' },
  reassure: { role: 'body400', fontSize: 14.5, lineHeight: 22, color: 'muted' },
  inst: { role: 'body400', fontSize: 14, color: 'muted' },
  profileSub: { role: 'body400', fontSize: 14, color: 'muted' },
} satisfies Record<string, TypeSpec>;

export type TypeVariant = keyof typeof typeScale;
