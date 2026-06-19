// theme.ts — design tokens ported from design-reference/pay.css (:root + type scale).
// Single source of truth for colors, fonts, type scale, radii, spacing, shadows.
import type { TextStyle, ViewStyle } from 'react-native';

/* ---- color ---- */
export const colors = {
  canvas: '#F5F6F4',
  surface: '#FFFFFF',
  ink: '#16181C',
  muted: '#8A8E94',
  hair: '#EAEBE8',
  accent: '#9A7B33', // antique gold (was emerald #0E7A63) — ~4.6:1 on white, legible as text/figures
  inkSoft: '#F1F2EF',
  accentSoft: '#F3EEDF', // warm cream-gold (~accent mixed 13% into white)
  accentLine: 'rgba(154,123,51,0.35)', // soft gold border (was a hardcoded teal rgba)
  danger: '#C0392B', // error red (was hardcoded in onboarding screens)
  scrim: 'rgba(16,18,20,0.42)',
  grab: '#dcddd8',
  white: '#FFFFFF',
  // warm near-black shadow base so shadows/glows harmonize with gold
  shadowBase: '#1C1610',
} as const;

/* ---- fonts (family strings must match keys in lib/fonts.ts) ---- */
export const fonts = {
  disp700: 'SchibstedGrotesk_700Bold',
  disp800: 'SchibstedGrotesk_800ExtraBold',
  body400: 'Inter_400Regular',
  body500: 'Inter_500Medium',
  body600: 'Inter_600SemiBold',
  mono400: 'SplineSansMono_400Regular',
  mono500: 'SplineSansMono_500Medium',
  mono600: 'SplineSansMono_600SemiBold',
} as const;

/* ---- shape ---- */
export const radii = {
  sheet: 30,
  rlc: 20,
  card: 18,
  tile: 16,
  field: 14,
  row: 14,
  chip: 13,
  iconSq: 11,
  iconSqSm: 10,
  pill: 999,
  logo: 9,
  logoXl: 16,
} as const;

export const GUTTER = 20;
export const SHEET_GUTTER = 22;

/* ---- shadows (iOS shadow* + Android elevation) ---- */
export const shadows = {
  card: {
    shadowColor: colors.shadowBase,
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  rlc: {
    shadowColor: colors.shadowBase,
    shadowOpacity: 0.1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  sheet: {
    shadowColor: colors.shadowBase,
    shadowOpacity: 0.16,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 24,
  },
  primaryBtn: {
    shadowColor: colors.accent, // gold halo under the ink primary button
    shadowOpacity: 0.42,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  payBtn: {
    shadowColor: colors.accent, // gold halo under the ink Pay button
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  segPill: {
    shadowColor: colors.shadowBase,
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
} satisfies Record<string, ViewStyle>;

/* ---- type scale (ported from README type table + pay.css) ---- */
export const type = {
  // Display
  heroBalance: { fontFamily: fonts.disp800, fontSize: 52, letterSpacing: -1.56, lineHeight: 53 },
  bigAmount: { fontFamily: fonts.disp800, fontSize: 56, letterSpacing: -1.68 },
  result: { fontFamily: fonts.disp700, fontSize: 26, letterSpacing: -0.26, color: colors.ink },
  screenTitle: { fontFamily: fonts.disp700, fontSize: 24, letterSpacing: -0.24, color: colors.ink },
  sheetTitle: { fontFamily: fonts.disp700, fontSize: 21, letterSpacing: -0.21, color: colors.ink },
  flipFig: { fontFamily: fonts.disp700, fontSize: 27, letterSpacing: -0.54 },
  payeeWho: { fontFamily: fonts.disp700, fontSize: 19, color: colors.ink },
  brandWord: { fontFamily: fonts.disp700, fontSize: 19, letterSpacing: -0.19, color: colors.ink },
  logo: { fontFamily: fonts.disp700, fontSize: 17, color: colors.white },
  logoXl: { fontFamily: fonts.disp700, fontSize: 30, color: colors.white },
  tierTitle: { fontFamily: fonts.disp700, fontSize: 18, color: colors.ink },
  onbH1: { fontFamily: fonts.disp700, fontSize: 28, letterSpacing: -0.42, lineHeight: 31, color: colors.ink },
  avatarInitial: { fontFamily: fonts.disp700, fontSize: 16, color: colors.ink },
  profileAvatar: { fontFamily: fonts.disp700, fontSize: 20, color: colors.ink },

  // Mono — money / rate / handles / timestamps
  rlcFigA: { fontFamily: fonts.mono500, fontSize: 25, letterSpacing: -0.25 },
  rlcFigB: { fontFamily: fonts.mono500, fontSize: 24, letterSpacing: -0.24 },
  rlcFigBg: { fontFamily: fonts.mono500, fontSize: 30, letterSpacing: -0.3 },
  rlcFigC: { fontFamily: fonts.mono500, fontSize: 38, letterSpacing: -0.38 },
  rlcMicro: {
    fontFamily: fonts.mono500,
    fontSize: 10.5,
    letterSpacing: 0.84,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  eyebrow: {
    fontFamily: fonts.mono500,
    fontSize: 11,
    letterSpacing: 1.43,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  dayLabel: {
    fontFamily: fonts.mono500,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  tierTag: {
    fontFamily: fonts.mono600,
    fontSize: 11,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
  },
  rowAmount: { fontFamily: fonts.mono500, fontSize: 15, color: colors.ink },
  rowTime: { fontFamily: fonts.mono400, fontSize: 12, color: colors.muted },
  sub: { fontFamily: fonts.mono400, fontSize: 14, color: colors.muted },
  conv: { fontFamily: fonts.mono400, fontSize: 15, color: colors.muted },
  rateLine: { fontFamily: fonts.mono400, fontSize: 12.5, color: colors.muted },
  keypad: { fontFamily: fonts.mono500, fontSize: 24, color: colors.ink },
  keypadFn: { fontFamily: fonts.mono500, fontSize: 20, color: colors.muted },
  chip: { fontFamily: fonts.mono500, fontSize: 15 },
  fieldText: { fontFamily: fonts.mono400, fontSize: 16, color: colors.ink },
  handle: { fontFamily: fonts.mono400, fontSize: 16, color: colors.ink },
  monoSmall: { fontFamily: fonts.mono400, fontSize: 12, color: colors.muted },
  version: { fontFamily: fonts.mono400, fontSize: 12, color: colors.muted },

  // Body — UI text
  rowName: { fontFamily: fonts.body500, fontSize: 15, letterSpacing: -0.075, color: colors.ink },
  lead: { fontFamily: fonts.body400, fontSize: 14.5, lineHeight: 22, color: colors.muted },
  leadInk: { fontFamily: fonts.body400, fontSize: 15, lineHeight: 22, color: colors.muted },
  note: { fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.muted },
  caption: { fontFamily: fonts.body400, fontSize: 13, color: colors.muted },
  button: { fontFamily: fonts.body600, fontSize: 16.5, letterSpacing: -0.165 },
  buttonSm: { fontFamily: fonts.body600, fontSize: 15, letterSpacing: -0.15 },
  textlink: { fontFamily: fonts.body500, fontSize: 14.5, color: colors.muted },
  tabLabel: { fontFamily: fonts.body500, fontSize: 11 },
  tileLabel: { fontFamily: fonts.body500, fontSize: 13.5, color: colors.ink },
  filter: { fontFamily: fonts.body500, fontSize: 13 },
  seeAll: { fontFamily: fonts.body500, fontSize: 13, color: colors.accent },
  kvKey: { fontFamily: fonts.body400, fontSize: 14, color: colors.muted },
  searchPh: { fontFamily: fonts.body400, fontSize: 14.5, color: colors.muted },
  tierDesc: { fontFamily: fonts.body400, fontSize: 14, lineHeight: 20, color: colors.muted },
  reassure: { fontFamily: fonts.body400, fontSize: 14.5, lineHeight: 22, color: colors.muted },
  inst: { fontFamily: fonts.body400, fontSize: 14, color: colors.muted },
  profileSub: { fontFamily: fonts.body400, fontSize: 14, color: colors.muted },
} satisfies Record<string, TextStyle>;
