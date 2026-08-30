// ResultBlock — centered hero used on Success / Declined / Detail / Sent. Web port.
import type { CSSProperties, ReactNode } from 'react';

import { colors, ResultBadge, Txt, type, View } from '@fpay/ui';

export function ResultBlock({
  kind,
  icon,
  headline,
  sub,
  inst,
  paddingTop,
}: {
  kind: 'ok' | 'no';
  icon: ReactNode;
  headline: string;
  sub?: string;
  inst?: string;
  paddingTop?: number;
}) {
  return (
    <View style={[styles.result, paddingTop != null && { paddingTop }]}>
      <ResultBadge kind={kind}>{icon}</ResultBadge>
      <Txt style={type.result}>{headline}</Txt>
      {inst ? (
        <View style={styles.inst}>
          <View style={styles.dot} />
          <Txt style={type.inst}>{inst}</Txt>
        </View>
      ) : null}
      {sub ? <Txt style={styles.sub}>{sub}</Txt> : null}
    </View>
  );
}

const styles = {
  result: { alignItems: 'center', gap: 10, paddingTop: 6 },
  inst: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.accent },
  sub: { ...type.reassure, textAlign: 'center' },
} satisfies Record<string, CSSProperties>;
