// tokens.ts — the SINGLE SOURCE OF TRUTH for design tokens, shared by web + mobile.
// Pure data only (no react / react-native imports) so it's safe in every bundle, including
// the backend. Platform-agnostic values live here; each app's lib/theme.ts is a thin adapter
// that turns these into platform representations (web CSS vs RN styles). Re-skin = edit here.
//
// THEME: "frenspay v2" — the art direction sampled from the four scene paintings (play, stay,
// pay, relay) that live in apps/landing/public/scenes. Paper and sky are two thirds of any
// frame, water and shadow carry the weight, and terracotta is the only saturated thing in the
// world — which is why it is always the subject. Two faces and no third: Spectral for anything
// the brand SAYS, JetBrains Mono for anything that only MARKS.
// (Supersedes the warm Material-3 / Hanken Grotesk system, which superseded violet / Baloo 2.)
// The written system lives in design-reference/fpay/README.md.

/* ---- Tier 1: brand seeds (change these to re-skin everything) ---- */
// The thirteen values the paintings actually contain, named for the thing they were sampled
// from rather than for a UI role — that naming is the point. A role can be re-pointed at a
// different one of these; none of them can be re-invented.
export const brand = {
  // paper & sky — 55-80% of any frame
  sun: '#fdf3dc',
  paper: '#fce8cb',
  paperWarm: '#fadba7',
  cloud: '#f8cba0',
  cloudDeep: '#f2b48c',
  sand: '#dbb88b',
  // water & shadow
  sage: '#718479',
  water: '#4e6d6a',
  waterDeep: '#3a6467',
  petrol: '#0e3d45',
  ink: '#2b3131',
  // the one accent — under 2% of any frame
  terracotta: '#b94f2b',
  ember: '#e5813f',
  terracottaDeep: '#8f3a1e', // pressed, and terracotta's only AA-safe cut as small text
  // On white: NOT the surface colour any more (that is `sun`), but still the label on a
  // terracotta fill. Measured — white on terracotta is 4.98:1 and `sun` on it is 4.51:1, and
  // the primary action of a money app is not the place to spend that margin on purity.
  white: '#ffffff',
  // Not sampled, deliberately: an error colour in a money app is a safety affordance, not
  // decoration. Ember is the nearest thing in this world and reads as warmth — the opposite
  // of what this has to say.
  error: '#ba1a1a',
} as const;

/* ---- Tier 2: semantic colour roles (apps import these via lib/theme) ---- */
// Every ratio quoted below is measured against `canvas` unless stated. AA is 4.5:1 for text
// and 3:1 for the borders of interactive things.
export const colors = {
  canvas: brand.paper, // page background — the paper the whole world is painted on
  surface: brand.sun, // cards sit LIGHTER than the page, the way white sat on cream before
  surfaceLow: brand.paperWarm, // container-low
  surfaceContainer: brand.cloud, // container
  surfaceHigh: brand.cloudDeep, // container-high
  surfaceVariant: brand.sand,
  ink: brand.ink, // primary text — 11.1:1
  // The stone family the system sets its own secondary copy in. #6b6156 is verbatim; `tertiary`
  // is one step down from its #7a7065, which measures 4.05:1 — the smallest nudge that clears AA.
  muted: '#6b6156', // 5.1:1
  tertiary: '#726859', // 4.6:1
  hair: 'rgba(43,49,49,0.15)', // dividers — the exact rule the system draws its own sections with
  outline: '#8a7a63', // borders of interactive things — 3.5:1
  outlineVariant: '#9c8a70', // quiet borders — decorative only, 2.8:1
  accent: brand.terracotta, // the rust event. Fills and display type; see accentDeep for small text
  accentDeep: brand.terracottaDeep, // 6.3:1 — accent as body-sized text, and pressed states
  accentSoft: brand.cloudDeep, // ink on it is 7.4:1
  accentLine: 'rgba(185,79,43,0.30)',
  inkSoft: brand.cloud, // neutral pressed / chip fill
  // The world has no pale teal and one is not invented here. `secondarySoft` is therefore the
  // solid water with paper on top (4.7:1) rather than a light container with dark text.
  secondary: brand.water,
  secondarySoft: brand.water,
  onSecondary: brand.paper,
  danger: brand.error,
  pos: brand.water, // money-positive / settled
  scrim: 'rgba(43,49,49,0.42)',
  grab: brand.sand,
  white: brand.white,
  shadowBase: brand.ink, // rgba(43,49,49) — shadow in this world is the silhouette colour
  shadowWarm: '#6b6156', // rgba(107,97,86) — warm elevated shadow
  // legacy category keys (kept so existing call sites compile) → mapped on-brand
  amber: '#726859',
  mint: brand.water,
  coral: brand.terracotta,
  amberSoft: brand.cloud,
  mintSoft: brand.sage,
  coralSoft: brand.cloudDeep,
} as const;

export type ColorKey = keyof typeof colors;

/* ---- Tier 3: component tokens ---- */
// Flat-colour action tiles (Home: Add / Send / Request).
export const tile = {
  add: { bg: brand.cloudDeep, fg: brand.ink }, // 7.4:1
  send: { bg: brand.terracotta, fg: brand.white }, // 5.0:1 — the one rust event on the screen
  request: { bg: brand.water, fg: brand.paper }, // 4.7:1
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

/* ---- type scale (metrics only; apps apply the platform font) ---- */
// FontRole names are retained across re-skins so the adapter machinery is unchanged — only what
// they RENDER changes. Under v2: `disp*` and `body*` are Spectral (the voice), `mono*` is real
// JetBrains Mono (the marks), which retires the previous system's fake mono — Hanken Grotesk
// with tabular figures switched on. See packages/ui/src/theme.ts for the weights.
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
  // accentDeep, not accent: terracotta is 4.2:1 on paper and this is 13px. See colors.accentDeep.
  seeAll: { role: 'body600', fontSize: 13, color: 'accentDeep' },
  kvKey: { role: 'body400', fontSize: 14, color: 'muted' },
  searchPh: { role: 'body400', fontSize: 15, color: 'muted' },
  tierDesc: { role: 'body400', fontSize: 14, lineHeight: 20, color: 'muted' },
  reassure: { role: 'body400', fontSize: 14.5, lineHeight: 22, color: 'muted' },
  inst: { role: 'body400', fontSize: 14, color: 'muted' },
  profileSub: { role: 'body400', fontSize: 14, color: 'muted' },
} satisfies Record<string, TypeSpec>;

export type TypeVariant = keyof typeof typeScale;
