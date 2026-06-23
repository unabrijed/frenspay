'use client';

// Activity — open payment requests + filterable transaction history.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { TxRow } from '@/components/TxRow';
import { Btn, TextLink } from '@/components/ui/Button';
import { Fav, List, Row, RowAmount, RowMeta } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { usd } from '@/lib/money';
import { colors, GUTTER, type } from '@/lib/theme';
import { relTime } from '@/services/mappers';
import type { Txn } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

const FILTERS = ['All', 'Payments', 'Friends'] as const;
type Filter = (typeof FILTERS)[number];

// numberOfLines={1} → single-line truncation.
const clamp1: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function Requests() {
  const requests = usePayStore((s) => s.requests);
  const payRequest = usePayStore((s) => s.payRequest);
  const cancelRequest = usePayStore((s) => s.cancelRequest);
  const busy = usePayStore((s) => s.busy);
  const open = requests.filter((r) => r.status === 'open');
  if (open.length === 0) return null;

  return (
    <>
      <Txt style={[type.dayLabel, styles.dayLabel]}>Requests</Txt>
      <List style={{ marginBottom: 18 }}>
        {open.map((r) => {
          const handle = r.counterpartyHandle ?? '';
          const ini = (handle.replace(/^@/, '').charAt(0) || '?').toUpperCase();
          const incoming = r.direction === 'incoming';
          return (
            <View key={r.id}>
              <Row>
                <Fav label={ini} />
                <RowMeta>
                  <Txt style={[type.rowName, clamp1]}>
                    {incoming ? `${handle} asks you` : `You asked ${handle || 'someone'}`}
                  </Txt>
                  <Txt style={[type.rowTime, { marginTop: 3 }]}>{relTime(r.createdAt)}</Txt>
                </RowMeta>
                <RowAmount>
                  <Txt style={type.rowAmount}>{usd(r.amountUsd)}</Txt>
                </RowAmount>
              </Row>
              <View style={styles.reqAction}>
                {incoming ? (
                  <Btn
                    label={`Pay ${usd(r.amountUsd)}`}
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
    </>
  );
}

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
    <Screen edges={['top']} style={styles.safe}>
      <View style={[styles.scroll, { overflowY: 'auto' }]}>
        <View style={styles.fhead}>
          <Txt style={type.screenTitle}>Activity</Txt>
        </View>
        <Requests />
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
      </View>
    </Screen>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1, paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  fhead: { paddingTop: 4, paddingLeft: 2, paddingRight: 2, paddingBottom: 6 },
  filters: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 14 },
  f: {
    paddingTop: 7,
    paddingBottom: 7,
    paddingLeft: 14,
    paddingRight: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hair,
    backgroundColor: colors.surface,
  },
  fOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  dayLabel: { marginTop: 4, marginBottom: 9, marginLeft: 2, marginRight: 2 },
  reqAction: { paddingLeft: 16, paddingRight: 16, paddingBottom: 13, paddingTop: 2 },
} satisfies Record<string, CSSProperties>;
