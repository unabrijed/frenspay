// Transaction detail — result hero, rate lock, detail list, and for a payment you made, the trip
// it sits in and how it is split. Port of the web's detail/page.tsx.
import { fullTime, MaskedAmount, RateLock, usePayStore } from '@fpay/app';
import { inrRaw, usd } from '@fpay/shared';
import { BackButton, Btn, colors, fonts, GUTTER, Icons, List, ResultBadge, rnStyle, Row, RowAmount, RowMeta, Screen, Spacer, Txt, type, View } from '@fpay/ui';
import { useRouter } from 'expo-router';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import { ScrollView } from 'react-native';

export default function Detail() {
  const router = useRouter();
  const tx = usePayStore((s) => s.detail) ?? usePayStore((s) => s.transactions[0]);
  const hideAmounts = usePayStore((s) => s.hideAmounts);
  const groups = usePayStore((s) => s.groups);
  const requests = usePayStore((s) => s.requests);
  const setExpense = usePayStore((s) => s.setExpense);
  const open = usePayStore((s) => s.open);
  useEffect(() => {
    if (!tx) router.back();
  }, [tx, router]);
  if (!tx) return null;
  const merchant = tx.type === 'pay';
  const isAdd = tx.type === 'add';
  const out = tx.usd < 0;
  // Only a payment YOU made can be put in a trip or split — never one that settled a share.
  const splittable = out && !isAdd && !tx.settlesNote && tx.status !== 'failed';
  const shares = requests.filter((r) => r.direction === 'outgoing' && r.splitOf === tx.id && r.status !== 'cancelled');
  const tripName = tx.groupId ? groups.find((g) => g.id === tx.groupId)?.name : undefined;
  const act = (sheet: 'split' | 'moveToGroup') => {
    setExpense({ id: tx.id, amountUsd: Math.abs(tx.usd), label: tx.title, groupId: tx.groupId });
    open(sheet);
  };
  const status = isAdd ? 'Added' : tx.status === 'pending' ? 'Processing' : tx.status === 'failed' ? 'Failed' : out ? 'Paid' : 'Received';
  const money = (n: number) => (hideAmounts ? '••••' : usd(n));

  return (
    <Screen edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={rnStyle(styles.scroll)}>
        <View style={styles.fhead}>
          <BackButton onPress={() => router.back()} />
        </View>

        <View style={styles.result}>
          <ResultBadge kind={isAdd || merchant ? 'ok' : 'no'}>
            {isAdd ? (
              <Icons.Plus size={26} color={colors.accent} />
            ) : merchant ? (
              <Icons.Check size={30} color={colors.accent} />
            ) : (
              <Icons.Send size={24} color={colors.muted} />
            )}
          </ResultBadge>
          <MaskedAmount value={merchant && tx.rupees ? inrRaw(tx.rupees) : usd(Math.abs(tx.usd))} style={type.result} />
          <Txt style={[type.reassure, { color: colors.muted }]}>{tx.title}</Txt>
        </View>

        {merchant && tx.rupees ? (
          <View style={{ marginTop: 22 }}>
            <RateLock payUsd={Math.abs(tx.usd)} getR={tx.rupees} />
          </View>
        ) : null}

        <View style={{ marginTop: 16 }}>
          <List>
            <DetailRow k="Status" v={status} accent />
            <DetailRow k={out ? 'Paid from' : 'Amount'} v={money(Math.abs(tx.usd))} />
            {tx.yourPart !== undefined && tx.yourPart !== Math.abs(tx.usd) ? <DetailRow k="Your part" v={money(tx.yourPart)} /> : null}
            {tx.settlesNote ? <DetailRow k={out ? 'Your part of' : 'Settles'} v={tx.settlesNote} /> : null}
            <DetailRow k="Date" v={tx.createdAt ? fullTime(tx.createdAt) : tx.time} />
            {splittable ? <DetailRow k="Trip" v={tripName ?? 'Personal'} onPress={() => act('moveToGroup')} /> : null}
            {splittable ? (
              <DetailRow
                k="Split"
                v={shares.length ? `${shares.length} ${shares.length === 1 ? 'person' : 'people'}` : 'Not split'}
                onPress={() => act('split')}
              />
            ) : null}
          </List>
        </View>

        <Spacer />
        <View style={styles.cta}>
          <Btn label="Share receipt" variant="secondary" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function DetailRow({ k, v, accent, onPress }: { k: string; v: string; accent?: boolean; onPress?: () => void }) {
  return (
    <Row onPress={onPress}>
      <RowMeta>
        <Txt style={styles.label}>{k}</Txt>
      </RowMeta>
      <RowAmount>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt style={[type.rowAmount, accent && { color: colors.accent }]}>{v}</Txt>
          {onPress ? <Icons.Chevron size={18} color={colors.muted} /> : null}
        </View>
      </RowAmount>
    </Row>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1, paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  fhead: { paddingTop: 8, paddingBottom: 6, paddingLeft: 2, paddingRight: 2 },
  result: { alignItems: 'center', gap: 10, paddingTop: 2 },
  label: { ...fonts.body400, fontSize: 15, color: colors.muted },
  cta: { paddingTop: 16 },
} satisfies Record<string, CSSProperties>;
