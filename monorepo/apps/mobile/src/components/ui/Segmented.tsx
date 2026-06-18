// Segmented — the Home INR/USD currency toggle (pay.css .seg).
import { Pressable, StyleSheet, View } from 'react-native';

import { Txt } from '@/components/ui/Txt';
import { colors, fonts, shadows } from '@/lib/theme';

export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = value === o;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={[styles.b, on && styles.bOn]}>
            <Txt style={[styles.label, { color: on ? colors.ink : colors.muted }]}>{o}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: colors.inkSoft, borderRadius: 999, padding: 3, gap: 2 },
  b: { paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999 },
  bOn: { backgroundColor: colors.surface, ...shadows.segPill },
  label: { fontFamily: fonts.mono600, fontSize: 11 },
});
