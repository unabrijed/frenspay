'use client';

// primitives.tsx — shared building blocks, web port of the mobile primitives.
import type { CSSProperties, ReactNode } from 'react';

import { Icons } from '@/components/icons';
import { Txt } from '@/components/ui/Txt';
import { Pressable, type St, sx, View } from '@/components/ui/rn';
import { colors, radii, shadows, type } from '@/lib/theme';

/* ---- generic ---- */
export const Spacer = () => <View style={{ flex: 1 }} />;
export const Hairline = ({ style }: { style?: St | St[] }) => (
  <View style={[{ height: 1, backgroundColor: colors.hair }, style as St]} />
);

export function Eyebrow({ children, style }: { children: ReactNode; style?: St | St[] }) {
  return <Txt style={[type.eyebrow, style as St]}>{children}</Txt>;
}

/* ---- card + list + rows ---- */
export function Card({ children, style }: { children: ReactNode; style?: St | St[] }) {
  return <View style={[styles.card, style as St]}>{children}</View>;
}

/** White rounded list card; inserts a full-width hairline between children. */
export function List({ children, style }: { children: ReactNode; style?: St | St[] }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={[styles.list, style as St]}>
      {items.map((c, i) => (
        <View key={i}>
          {i > 0 ? <Hairline /> : null}
          {c}
        </View>
      ))}
    </View>
  );
}

export function Row({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: St | St[];
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, onPress && pressed ? { backgroundColor: colors.inkSoft } : null, style as St]}
    >
      {children}
    </Pressable>
  );
}

export function RowIcon({
  children,
  accent,
  tone,
}: {
  children: ReactNode;
  accent?: boolean;
  /** Solid category colour (e.g. coral/mint/violet) — chip fills with it, icon goes white. */
  tone?: string;
}) {
  return (
    <View style={[styles.ric, accent && { backgroundColor: colors.accentSoft }, tone ? { backgroundColor: tone } : null]}>
      {children}
    </View>
  );
}

export const RowMeta = ({ children }: { children: ReactNode }) => <View style={styles.meta}>{children}</View>;
export const RowAmount = ({ children }: { children: ReactNode }) => <View style={styles.amt}>{children}</View>;

/* ---- key/value ---- */
export function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.kv}>
      <Txt style={type.kvKey}>{k}</Txt>
      <Txt style={[type.rowAmount, { fontSize: 14.5 }]}>{v}</Txt>
    </View>
  );
}

/* ---- field / chip / search ---- */
export function Field({ children, style }: { children: ReactNode; style?: St | St[] }) {
  return <View style={[styles.field, style as St]}>{children}</View>;
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.85 }]}>
      <Txt style={[type.chip, { color: on ? colors.white : colors.ink }]}>{label}</Txt>
    </Pressable>
  );
}

export const Chips = ({ children }: { children: ReactNode }) => <View style={styles.chips}>{children}</View>;

export function SearchBar({
  placeholder,
  value,
  onChangeText,
  autoFocus,
}: {
  placeholder: string;
  value?: string;
  onChangeText?: (t: string) => void;
  autoFocus?: boolean;
}) {
  // Controlled when both value + onChangeText are given; otherwise renders the old static label.
  const controlled = value !== undefined && onChangeText !== undefined;
  return (
    <View style={styles.search}>
      <Icons.Search size={18} color={colors.muted} />
      {controlled ? (
        <input
          value={value}
          onChange={(e) => onChangeText?.(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={sx(type.searchPh, { flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: 0, color: colors.ink })}
        />
      ) : (
        <Txt style={type.searchPh}>{placeholder}</Txt>
      )}
    </View>
  );
}

/* ---- avatars / logos / squares ---- */
export function Logo() {
  return (
    <View style={styles.logo}>
      <Txt style={type.logo}>T</Txt>
    </View>
  );
}
export function LogoXl() {
  return (
    <View style={styles.logoXl}>
      <Txt style={type.logoXl}>T</Txt>
    </View>
  );
}
export function Avatar({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.7 }]}>
      <Txt style={{ ...type.rowTime, fontSize: 13 }}>{label}</Txt>
    </Pressable>
  );
}
export function Fav({ label }: { label: string }) {
  return (
    <View style={styles.fav}>
      <Txt style={type.avatarInitial}>{label}</Txt>
    </View>
  );
}
export function ProfileAvatar({ label }: { label: string }) {
  return (
    <View style={styles.profileAvatar}>
      <Txt style={type.profileAvatar}>{label}</Txt>
    </View>
  );
}
export function IconSquare({ children }: { children: ReactNode }) {
  return <View style={styles.iconSquare}>{children}</View>;
}
export function GlyphCircle({ children }: { children: ReactNode }) {
  return <View style={styles.glyphCircle}>{children}</View>;
}
export function AvailBadge({ children }: { children: ReactNode }) {
  return <View style={styles.availBadge}>{children}</View>;
}

/* ---- result badge (success / declined / detail hero) ---- */
export function ResultBadge({ children, kind }: { children: ReactNode; kind: 'ok' | 'no' }) {
  return (
    <View style={[styles.badge, { backgroundColor: kind === 'ok' ? colors.accentSoft : colors.inkSoft }]}>
      {children}
    </View>
  );
}

/* ---- sheet chrome ---- */
export const Grab = () => <View style={styles.grab} />;

export function SheetClose({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.x, pressed && { opacity: 0.7 }]}>
      <Icons.Close size={15} color={colors.muted} strokeWidth={2} />
    </Pressable>
  );
}

export function SheetHeader({
  title,
  eyebrow,
  onClose,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.shead}>
      <View style={{ flexShrink: 1 }}>
        {eyebrow ? <Eyebrow style={{ marginBottom: 4 }}>{eyebrow}</Eyebrow> : null}
        <Txt style={eyebrow ? type.payeeWho : type.sheetTitle}>{title}</Txt>
      </View>
      <SheetClose onPress={onClose} />
    </View>
  );
}

export const SheetBody = ({ children, style }: { children: ReactNode; style?: St | St[] }) => (
  <View style={[styles.sbody, style as St]}>{children}</View>
);

const border = (c: string, w = 1): CSSProperties => ({ borderWidth: w, borderStyle: 'solid', borderColor: c });

const styles = {
  card: { backgroundColor: colors.surface, ...border(colors.hair), borderRadius: radii.card, boxShadow: shadows.card },
  list: {
    backgroundColor: colors.surface,
    ...border(colors.hair),
    borderRadius: radii.card,
    overflow: 'hidden',
    boxShadow: shadows.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingTop: 14,
    paddingBottom: 14,
    paddingLeft: 16,
    paddingRight: 16,
    width: '100%',
    backgroundColor: colors.surface,
  },
  ric: {
    width: 38,
    height: 38,
    borderRadius: radii.iconSq,
    backgroundColor: colors.inkSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  meta: { flex: 1, minWidth: 0 },
  amt: { alignItems: 'flex-end' },
  kv: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    ...border(colors.hair),
    borderRadius: radii.row,
    paddingTop: 14,
    paddingBottom: 14,
    paddingLeft: 16,
    paddingRight: 16,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...border(colors.hair),
    borderRadius: radii.field,
    paddingTop: 13,
    paddingBottom: 13,
    paddingLeft: 15,
    paddingRight: 15,
    backgroundColor: colors.surface,
  },
  chips: { flexDirection: 'row', gap: 9 },
  chip: {
    flex: 1,
    ...border(colors.hair),
    borderRadius: radii.chip,
    backgroundColor: colors.surface,
    paddingTop: 13,
    paddingBottom: 13,
    alignItems: 'center',
  },
  chipOn: { borderColor: colors.ink, backgroundColor: colors.ink },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    ...border(colors.hair),
    borderRadius: radii.field,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 15,
    paddingRight: 15,
    backgroundColor: colors.surface,
    marginBottom: 14,
  },
  logo: { width: 30, height: 30, borderRadius: radii.logo, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  logoXl: { width: 56, height: 56, borderRadius: radii.logoXl, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.inkSoft,
    ...border(colors.hair),
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fav: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.inkSoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  profileAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.inkSoft,
    ...border(colors.hair),
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSquare: { width: 34, height: 34, borderRadius: radii.iconSqSm, backgroundColor: colors.inkSoft, alignItems: 'center', justifyContent: 'center' },
  glyphCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.inkSoft, alignItems: 'center', justifyContent: 'center' },
  availBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accentSoft,
    ...border(colors.accent, 1.5),
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  grab: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.grab, alignSelf: 'center', marginTop: 10, marginBottom: 2 },
  shead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 22,
    paddingRight: 22,
    paddingTop: 10,
    paddingBottom: 4,
  },
  x: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.inkSoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sbody: { flex: 1, paddingLeft: 22, paddingRight: 22, paddingTop: 6, paddingBottom: 26 },
} satisfies Record<string, CSSProperties>;
