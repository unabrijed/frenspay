// Segmented — the Home INR/USD currency toggle (pay.css .seg).
import { Pressable, StyleSheet, View } from 'react-native';

import { Txt } from '@/components/ui/Txt';
import { colors, fonts, shadows } from '@/lib/theme';

export function Segmented({
  value,
  options,
  onChange,
  onDark = false,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  /** Sits on a coloured (violet) surface — light track + violet active text. */
  onDark?: boolean;
}) {
  return (
    <View style={[styles.seg, onDark && styles.segDark]}>
      {options.map((o) => {
        const on = value === o;
        const labelColor = onDark ? (on ? colors.accent : 'rgba(255,255,255,0.92)') : on ? colors.ink : colors.muted;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={[styles.b, on && (onDark ? styles.bOnDark : styles.bOn)]}>
            <Txt style={[styles.label, { color: labelColor }]}>{o}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: colors.inkSoft, borderRadius: 999, padding: 3, gap: 2 },
  segDark: { backgroundColor: 'rgba(255,255,255,0.22)' },
  b: { paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999 },
  bOn: { backgroundColor: colors.surface, ...shadows.segPill },
  bOnDark: { backgroundColor: colors.white, ...shadows.segPill },
  label: { fontFamily: fonts.mono600, fontSize: 11 },
});
