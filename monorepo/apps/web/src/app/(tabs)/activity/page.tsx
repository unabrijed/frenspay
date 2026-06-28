'use client';

// Activity — Tabroad transaction history: trip-summary card, filters, and date-grouped tactile rows
// with Settling/Settled status. Plus the open-payment-requests block.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { Icons } from '@/components/icons';
import { TxCard } from '@/components/TxCard';
import { Btn, TextLink } from '@/components/ui/Button';
import { Fav, List, Row, RowAmount, RowMeta } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { inr, usd } from '@/lib/money';
import { colors, GUTTER, radii, shadows, type } from '@/lib/theme';
import { relTime } from '@/services/mappers';
import type { Txn } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

const FILTERS = ['All', 'Payments', 'Friends'] as const;
type Filter = (typeof FILTERS)[number];

const clamp1: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const isToday = (t: string) => /just now|^now|ago|today/i.test(t);

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
                  <Btn label={`Pay ${usd(r.amountUsd)}`} height={42} disabled={busy} onPress={() => void payRequest(r.id)} />
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
  const bal = usePayStore((s) => s.balanceUSD);
  const fxRate = usePayStore((s) => s.fxRate);
  const displayCurrency = usePayStore((s) => s.displayCurrency);
  const open = usePayStore((s) => s.open);
  const openDetail = usePayStore((s) => s.openDetail);
  const [f, setF] = useState<Filter>('All');
  const leadINR = displayCurrency === 'INR';

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
      <View style={[styles.scroll, { overflowY: 'auto' }]}>
        <View style={styles.fhead}>
          <Txt style={type.screenTitle}>Activity</Txt>
        </View>

        {/* trip summary */}
        <View style={styles.summary}>
          <Txt style={type.eyebrow}>Trip balance · India</Txt>
          <Txt style={[type.heroBalance, { fontSize: 38, lineHeight: '44px', marginTop: 6 }]}>{leadINR ? inr(bal, fxRate) : usd(bal)}</Txt>
          <View style={styles.realRate}>
            <Txt style={type.sub}>{leadINR ? `≈ ${usd(bal)}` : `≈ ${inr(bal, fxRate)}`}</Txt>
            <View style={styles.ratePill}>
              <Icons.LockCheck size={14} color={colors.accent} />
              <Txt style={[type.tierTag, { color: colors.muted }]}>Live rate</Txt>
            </View>
          </View>
          <Pressable onPress={() => open('add')} style={({ pressed }) => [styles.addFunds, pressed ? { opacity: 0.9 } : null]}>
            <Icons.Plus size={16} color={colors.white} />
            <Txt style={[type.tileLabel, { color: colors.white }]}>Add Funds</Txt>
          </Pressable>
        </View>

        <Requests />

        {/* filters */}
        <View style={styles.filters}>
          {FILTERS.map((x) => (
            <Pressable key={x} onPress={() => setF(x)} style={[styles.f, f === x && styles.fOn]}>
              <Txt style={[type.filter, { color: f === x ? colors.white : colors.ink }]}>{x}</Txt>
            </Pressable>
          ))}
        </View>

        {shown.length === 0 ? (
          <Txt style={[type.lead, { textAlign: 'center', marginTop: 18 }]}>No activity yet.</Txt>
        ) : (
          <>
            {group('Today', todayTx)}
            {group('Earlier', earlierTx)}
          </>
        )}
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
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surface,
  },
  fOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayLabel: { marginTop: 4, marginBottom: 9, marginLeft: 2, marginRight: 2 },
  txList: { gap: 10, marginBottom: 6 },
  reqAction: { paddingLeft: 16, paddingRight: 16, paddingBottom: 13, paddingTop: 2 },
  summary: { backgroundColor: colors.surfaceContainer, borderRadius: radii.rlc, padding: 18, marginBottom: 16, boxShadow: shadows.card },
  realRate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  ratePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 12,
    paddingTop: 5,
    paddingBottom: 5,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.outlineVariant,
  },
  addFunds: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 14,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingLeft: 14,
    paddingRight: 16,
    paddingTop: 8,
    paddingBottom: 8,
    boxShadow: shadows.primaryBtn,
  },
} satisfies Record<string, CSSProperties>;
