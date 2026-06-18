// BackButton — circular back chevron for full screens & onboarding (pay.css .bk).
import { Pressable, StyleSheet } from 'react-native';

import { Icons } from '@/components/icons';
import { colors } from '@/lib/theme';

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.bk, pressed && { opacity: 0.7 }]}>
      <Icons.Back size={18} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bk: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.inkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
