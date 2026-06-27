'use client';

// Segmented — the Home INR/USD currency toggle (pay.css .seg). Web port.
import type { CSSProperties } from 'react';

import { Txt } from '@/components/ui/Txt';
import { Pressable, type St, View } from '@/components/ui/rn';
import { colors, shadows } from '@/lib/theme';

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
    <View style={[styles.seg, onDark && styles.segDark] as St[]}>
      {options.map((o) => {
        const on = value === o;
        const labelColor = onDark ? (on ? colors.accent : 'rgba(255,255,255,0.92)') : on ? colors.ink : colors.muted;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            style={[styles.b, on && (onDark ? styles.bOnDark : styles.bOn)] as St[]}
          >
            <Txt style={[styles.label, { color: labelColor }]}>{o}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = {
  seg: { flexDirection: 'row', backgroundColor: colors.inkSoft, borderRadius: 999, padding: 3, gap: 2 },
  segDark: { backgroundColor: 'rgba(255,255,255,0.22)' },
  b: { paddingTop: 4, paddingBottom: 4, paddingLeft: 11, paddingRight: 11, borderRadius: 999 },
  bOn: { backgroundColor: colors.surface, boxShadow: shadows.segPill },
  bOnDark: { backgroundColor: colors.white, boxShadow: shadows.segPill },
  label: { fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12 },
} satisfies Record<string, CSSProperties>;
