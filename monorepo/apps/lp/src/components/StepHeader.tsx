'use client';

// StepHeader — the thin progress line over each onboarding screen: apply · details · stake. Shown only
// while a partner is not yet approved (an exited or under-floor partner opening these screens from
// Account is not on a step). One line, three bars, no prose.
import type { CSSProperties } from 'react';

import { View } from '@fpay/ui/rn';
import { Txt } from '@fpay/ui/Txt';
import { colors, type } from '@fpay/ui/theme';

export const STEPS = ['Apply', 'Your details', 'Stake'] as const;

export function StepHeader({ step }: { step: 1 | 2 | 3 }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {STEPS.map((s, i) => (
          <View key={s} style={[styles.bar, i < step ? { backgroundColor: colors.accent } : null]} />
        ))}
      </View>
      <Txt style={[type.rowTime, { marginTop: 6 }]}>{`Step ${step} of ${STEPS.length}`}</Txt>
    </View>
  );
}

const styles = {
  wrap: { marginBottom: 14 },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.hair },
} satisfies Record<string, CSSProperties>;
