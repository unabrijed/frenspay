'use client';

// TabBar — three flat tabs, props only: no router, no store. The partner console's Home · Activity ·
// Account. The payer app's BottomNav keeps its lifted Scan button and its own store; this is the plain
// sibling, here in the design system so the two share surface, radius, type and safe-area padding.
// Deliberately NOT exported from index.ts: Metro sees only the barrel (apps/mobile disables package
// exports for @fpay/*), so the phone never loads this file and it needs no .native twin.
import type { CSSProperties, ReactNode } from 'react';

import { Pressable, View } from './rn';
import { colors, shadows, type } from './theme';
import { Txt } from './Txt';

export interface TabItem {
  key: string;
  label: string;
  /** Rendered with the active or inactive colour, so the caller keeps its own icon set. */
  icon: (color: string) => ReactNode;
}

export function TabBar({ items, active, onPress }: { items: TabItem[]; active: string; onPress: (key: string) => void }) {
  return (
    <View style={styles.nav}>
      {items.map((it) => {
        const c = it.key === active ? colors.accent : colors.muted;
        return (
          <Pressable key={it.key} style={styles.it} onPress={() => onPress(it.key)}>
            {it.icon(c)}
            <Txt style={[type.tabLabel, { color: c }]}>{it.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = {
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    ...shadows.sheet,
    minHeight: 72,
    paddingTop: 12,
    paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
    flexShrink: 0,
  },
  it: { flex: 1, alignItems: 'center', gap: 4 },
} satisfies Record<string, CSSProperties>;
