'use client';

// BottomNav — custom tab bar: Home (left), lifted violet Pay button with violet halo (center),
// Activity (right). Web port of the mobile nav.
import type { CSSProperties } from 'react';

import { colors, Icons, Pressable, shadows, Txt, type, View } from '@fpay/ui';
import { usePayStore } from '../store';

// Props, not a router: Next and expo-router both answer push(), but neither hook is shared. The
// tabs layout of each app passes its own.
export function BottomNav({ active, onHome, onActivity: goActivity }: { active: 'home' | 'activity'; onHome: () => void; onActivity: () => void }) {
  const open = usePayStore((s) => s.open);
  const onActivity = active === 'activity';

  return (
    <View style={styles.nav}>
      <Pressable style={styles.it} onPress={onHome}>
        <Icons.Home size={22} color={!onActivity ? colors.accent : colors.muted} />
        <Txt style={[type.tabLabel, { color: !onActivity ? colors.accent : colors.muted }]}>Home</Txt>
      </Pressable>

      <Pressable style={styles.pay} onPress={() => open('scan')}>
        <View style={styles.payBtn}>
          <Icons.QrBig size={26} color={colors.white} />
        </View>
        <Txt style={[type.tabLabel, { color: colors.muted, marginTop: 6 }]}>Scan</Txt>
      </Pressable>

      <Pressable style={styles.it} onPress={goActivity}>
        <Icons.Activity size={22} color={onActivity ? colors.accent : colors.muted} />
        <Txt style={[type.tabLabel, { color: onActivity ? colors.accent : colors.muted }]}>Activity</Txt>
      </Pressable>
    </View>
  );
}

const styles = {
  nav: {
    position: 'relative',
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    ...shadows.sheet,
    minHeight: 86,
    paddingTop: 14,
    paddingLeft: 46,
    paddingRight: 46,
    paddingBottom: 'env(safe-area-inset-bottom)',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  it: { alignItems: 'center', gap: 6 },
  pay: { position: 'absolute', top: -22, left: '50%', marginLeft: -31, width: 62, alignItems: 'center' },
  payBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.payBtn,
  },
} satisfies Record<string, CSSProperties>;
