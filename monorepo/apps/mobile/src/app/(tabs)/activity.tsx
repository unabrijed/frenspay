// Activity — trip summary, open requests, filters, date-grouped rows. Port of the web's
// (tabs)/activity/page.tsx.
import { MaskedAmount, relTime, Skeleton, TxCard, TxListSkeleton, useBalanceDisplay, usePayStore } from '@fpay/app';
import { type Txn, usd } from '@fpay/shared';
import { Btn, colors, Empty, Fav, GUTTER, Icons, List, Pressable, radii, rnStyle, Row, RowAmount, RowMeta, Screen, shadows, TextLink, Txt, type, View } from '@fpay/ui';
import { useRouter } from 'expo-router';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { ScrollView } from 'react-native';

const FILTERS = ['All', 'Payments', 'Friends'] as const;
type Filter = (typeof FILTERS)[number];

const isToday = (t: string) => /just now|^now|ago|today/i.test(t);

function Requests() {
  const requests = usePayStore((s) => s.requests);
  const payRequest = usePayStore((s) => s.payRequest);
  const cancelRequest = usePayStore((s) => s.cancelRequest);
  const busy = usePayStore((s) => s.busy);
  const hideAmounts = usePayStore((s) => s.hideAmounts);
  const openSheet = usePayStore((s) => s.open);
  const openReqs = requests.filter((r) => r.status === 'open');

  return (
    <>
      <View style={styles.reqHeader}>
        <Txt style={[type.dayLabel, styles.dayLabel]}>Requests</Txt>
        <Pressable onPress={() => openSheet('request')}>
          <Txt style={[type.sub, { color: colors.accent }]}>+ New request</Txt>
        </Pressable>
      </View>
      {openReqs.length === 0 ? null : (
        <List style={{ marginBottom: 18 }}>
          {openReqs.map((r) => {
            const handle = r.counterpartyHandle ?? '';
            const ini = (handle.replace(/^@/, '').charAt(0) || '?').toUpperCase();
            const incoming = r.direction === 'incoming';
            return (
              <View key={r.id}>
                <Row>
                  <Fav label={ini} />
                  <RowMeta>
                    <Txt style={type.rowName} numberOfLines={1}>
                      {incoming ? `${handle} asks you` : `You asked ${handle || 'someone'}`}
                    </Txt>
                    <Txt style={[type.rowTime, { marginTop: 3 }]}>{relTime(r.createdAt)}</Txt>
                  </RowMeta>
                  <RowAmount>
                    <MaskedAmount value={usd(r.amountUsd)} style={type.rowAmount} />
                  </RowAmount>
                </Row>
                <View style={styles.reqAction}>
                  {incoming ? (
                    <Btn
                      label={hideAmounts ? 'Pay ••••' : `Pay ${usd(r.amountUsd)}`}
                      height={42}
                      disabled={busy}
                      onPress={() => void payRequest(r.id)}
                    />
                  ) : (
                    <TextLink label="Cancel request" onPress={() => void cancelRequest(r.id)} />
                  )}
                </View>
              </View>
            );
          })}
        </List>
      )}
    </>
  );
}

export default function Activity() {
  const router = useRouter();
  const txns = usePayStore((s) => s.transactions);
  const loaded = usePayStore((s) => s.firstLoadDone);
  const open = usePayStore((s) => s.open);
  const openDetail = usePayStore((s) => s.openDetail);
  const [f, setF] = useState<Filter>('All');
  const { primary, secondary } = useBalanceDisplay();
  const toggleFlip = usePayStore((s) => s.toggleFlip);

  const shown = txns.filter((t) => (f === 'All' ? true : f === 'Payments' ? t.type === 'pay' : t.type !== 'pay'));
  const todayTx = shown.filter((t) => isToday(t.time));
  const earlierTx = shown.filter((t) => !isToday(t.time));

  const openTx = (tx: Txn) => {
    openDetail(tx);
    router.push('/detail');
  };

  const group = (label: string, list: Txn[]) =>
    list.length > 0 ? (
      <>
        <Txt style={[type.dayLabel, styles.dayLabel]}>{label}</Txt>
        <View style={styles.txList}>
          {list.map((tx) => (
            <TxCard key={tx.id} tx={tx} showInr onPress={() => openTx(tx)} />
          ))}
        </View>
      </>
    ) : null;

  return (
    <Screen edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={rnStyle(styles.scroll)}>
        <View style={styles.fhead}>
          <Txt style={type.screenTitle}>Activity</Txt>
        </View>

        <View style={styles.summary}>
          <Txt style={type.eyebrow}>Trip balance</Txt>
          {loaded ? (
            <Txt style={[type.heroBalance, { fontSize: 38, lineHeight: '44px', marginTop: 6 }]}>{primary}</Txt>
          ) : (
            <Skeleton w={180} h={40} r={12} style={{ marginTop: 8, marginBottom: 4 }} />
          )}
          {secondary ? (
            <Pressable onPress={toggleFlip}>
              <View style={styles.realRate}>
                {loaded ? <Txt style={type.sub}>≈ {secondary}</Txt> : <Skeleton w={90} h={13} />}
                <View style={styles.ratePill}>
                  <Icons.LockCheck size={14} color={colors.accent} />
                  <Txt style={[type.tierTag, { color: colors.muted }]}>Live rate</Txt>
                </View>
              </View>
            </Pressable>
          ) : null}
          <Pressable onPress={() => open('add')} style={({ pressed }) => [styles.addFunds, pressed ? { opacity: 0.9 } : null]}>
            <Icons.Plus size={16} color={colors.white} />
            <Txt style={[type.tileLabel, { color: colors.white }]}>Add Funds</Txt>
          </Pressable>
        </View>

        <Requests />

        <View style={styles.filters}>
          {FILTERS.map((x) => (
            <Pressable key={x} onPress={() => setF(x)} style={[styles.f, f === x && styles.fOn]}>
              <Txt style={[type.filter, { color: f === x ? colors.white : colors.ink }]}>{x}</Txt>
            </Pressable>
          ))}
        </View>

        {!loaded ? (
          <View style={styles.txList}>
            <TxListSkeleton rows={4} />
          </View>
        ) : shown.length === 0 ? (
          <Empty label="No activity yet." />
        ) : (
          <>
            {group('Today', todayTx)}
            {group('Earlier', earlierTx)}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  fhead: { paddingTop: 4, paddingLeft: 2, paddingRight: 2, paddingBottom: 6 },
  filters: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 14 },
  f: { paddingTop: 7, paddingBottom: 7, paddingLeft: 14, paddingRight: 14, borderRadius: 999, borderWidth: 1, borderStyle: 'solid', borderColor: colors.outlineVariant, backgroundColor: colors.surface },
  fOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayLabel: { marginTop: 4, marginBottom: 9, marginLeft: 2, marginRight: 2 },
  reqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginRight: 2 },
  txList: { gap: 10, marginBottom: 6 },
  reqAction: { paddingLeft: 16, paddingRight: 16, paddingBottom: 13, paddingTop: 2 },
  summary: { backgroundColor: colors.surfaceContainer, borderRadius: radii.rlc, padding: 18, marginBottom: 16, ...shadows.card },
  realRate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  ratePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.surface, borderRadius: 999, paddingLeft: 10, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderWidth: 1, borderStyle: 'solid', borderColor: colors.outlineVariant },
  addFunds: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 14, backgroundColor: colors.accent, borderRadius: 999, paddingLeft: 14, paddingRight: 16, paddingTop: 8, paddingBottom: 8, ...shadows.primaryBtn },
} satisfies Record<string, CSSProperties>;
