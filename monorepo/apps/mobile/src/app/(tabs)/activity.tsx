// Activity — filterable transaction history (same row component as Home).
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TxRow } from '@/components/TxRow';
import { List } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { colors, GUTTER, type } from '@/lib/theme';
import type { Txn } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

const FILTERS = ['All', 'Payments', 'Friends'] as const;
type Filter = (typeof FILTERS)[number];

export default function Activity() {
  const router = useRouter();
  const txns = usePayStore((s) => s.transactions);
  const openDetail = usePayStore((s) => s.openDetail);
  const [f, setF] = useState<Filter>('All');

  const shown = txns.filter((t) => (f === 'All' ? true : f === 'Payments' ? t.type === 'pay' : t.type !== 'pay'));

  const openTx = (tx: Txn) => {
    openDetail(tx);
    router.push('/detail');
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.fhead}>
          <Txt style={type.screenTitle}>Activity</Txt>
        </View>
        <View style={styles.filters}>
          {FILTERS.map((x) => (
            <Pressable key={x} onPress={() => setF(x)} style={[styles.f, f === x && styles.fOn]}>
              <Txt style={[type.filter, { color: f === x ? colors.white : colors.ink }]}>{x}</Txt>
            </Pressable>
          ))}
        </View>
        <Txt style={[type.dayLabel, styles.dayLabel]}>Today</Txt>
        <List>
          {shown.map((tx) => (
            <TxRow key={tx.id} tx={tx} onPress={() => openTx(tx)} />
          ))}
        </List>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 24 },
  fhead: { paddingTop: 4, paddingHorizontal: 2, paddingBottom: 6 },
  filters: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 14 },
  f: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hair,
    backgroundColor: colors.surface,
  },
  fOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  dayLabel: { marginTop: 4, marginBottom: 9, marginHorizontal: 2 },
});
