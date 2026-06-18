// ResultBlock — centered hero used on Success / Declined / Detail / Sent.
import { StyleSheet, View } from 'react-native';

import { ResultBadge } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { colors, type } from '@/lib/theme';

export function ResultBlock({
  kind,
  icon,
  headline,
  sub,
  inst,
  paddingTop,
}: {
  kind: 'ok' | 'no';
  icon: React.ReactNode;
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

const styles = StyleSheet.create({
  result: { alignItems: 'center', gap: 10, paddingTop: 6 },
  inst: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.accent },
  sub: { ...type.reassure, textAlign: 'center' },
});
