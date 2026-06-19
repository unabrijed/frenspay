// BottomNav — custom tab bar: Home (left), lifted ink Pay button with gold halo (center,
// owns the pay action — no Pay tile on Home), Activity (right). Per pay.css .nav.
// Self-contained via expo-router hooks so it needs no navigator prop types.
import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icons } from '@/components/icons';
import { Txt } from '@/components/ui/Txt';
import { colors, shadows, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

export function BottomNav() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const open = usePayStore((s) => s.open);
  const onActivity = pathname.startsWith('/activity');

  return (
    <View style={[styles.nav, { height: 86 + insets.bottom, paddingBottom: insets.bottom }]}>
      <Pressable style={styles.it} onPress={() => router.navigate('/home')}>
        <Icons.Home size={22} color={!onActivity ? colors.accent : colors.muted} />
        <Txt style={[type.tabLabel, { color: !onActivity ? colors.accent : colors.muted }]}>Home</Txt>
      </Pressable>

      <Pressable style={styles.pay} onPress={() => open('scan')}>
        <View style={styles.payBtn}>
          <Icons.QrBig size={26} color={colors.white} />
        </View>
        <Txt style={[type.tabLabel, { color: colors.muted, marginTop: 6 }]}>Pay</Txt>
      </Pressable>

      <Pressable style={styles.it} onPress={() => router.navigate('/activity')}>
        <Icons.Activity size={22} color={onActivity ? colors.accent : colors.muted} />
        <Txt style={[type.tabLabel, { color: onActivity ? colors.accent : colors.muted }]}>Activity</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    backgroundColor: colors.surface,
    paddingTop: 14,
    paddingHorizontal: 46,
    justifyContent: 'space-between',
  },
  it: { alignItems: 'center', gap: 6 },
  pay: { position: 'absolute', top: -22, left: '50%', marginLeft: -31, width: 62, alignItems: 'center' },
  payBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.ink, // ink circle + white QR icon; the gold lives in the halo (shadows.payBtn)
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.payBtn,
  },
});
