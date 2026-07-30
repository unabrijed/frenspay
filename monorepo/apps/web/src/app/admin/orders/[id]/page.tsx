'use client';

// /admin/orders/[id] — the full flow record for one order: raw event timeline, routing
// attempts, dispute, and escrow transfer legs. Deliberately NOT the consumer 7-step tracker —
// the operator wants what actually happened, timestamps and all.
import { useParams, useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { AdminOrderDetailResponse } from '@fpay/shared';

import { BackButton } from '@/components/ui/BackButton';
import { List, Row, RowMeta } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { usd } from '@/lib/money';
import { colors, fonts, GUTTER, type } from '@/lib/theme';
import { api, ApiError } from '@/services/api';

const mono13: CSSProperties = { ...fonts.mono400, fontSize: 13 };
const clamp1: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const at = (iso: string) => new Date(iso).toLocaleString();

function stateColor(state: string, resolution: string | null): string {
  if (state === 'failed' || resolution === 'under_review') return colors.danger;
  if (resolution) return colors.accent;
  if (state === 'completed') return colors.secondary;
  if (state === 'refunded') return colors.muted;
  return colors.ink;
}

export default function AdminOrderDetail() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AdminOrderDetailResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDetail(await api.adminOrder(id));
      setErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setErr('Not authorized.');
      else if (e instanceof ApiError && e.status === 404) setErr('Order not found.');
      else setErr(friendlyError(e));
    }
  }, [id]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 8000);
    return () => clearInterval(t);
  }, [reload]);

  const o = detail?.order;
  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.back()} />
      </View>
      <View style={styles.scroll}>
        {o ? (
          <>
            <Txt style={type.handle}>{usd(o.amountUsdc)}</Txt>
            <Txt style={[type.profileSub, { marginTop: 2 }]}>
              {o.userHandle} → {o.merchantName} · {o.referenceCode}
            </Txt>
            <Txt style={{ ...mono13, marginTop: 6, color: stateColor(o.state, o.resolution) }}>
              {o.state}
              {o.resolution ? ` · ${o.resolution}` : ''}
              {o.feedbackUp != null ? (o.feedbackUp ? ' · 👍' : ' · 👎') : ''}
            </Txt>

            <Txt style={[type.kvKey, styles.section]}>Timeline</Txt>
            <List>
              {(o.events ?? []).map((e, i) => (
                <Row key={i}>
                  <RowMeta>
                    <Txt style={{ ...mono13, color: colors.ink }}>{e.event}</Txt>
                    <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>
                      {e.fromState ?? '—'} → {e.toState}
                      {e.detail ? ` · ${JSON.stringify(e.detail)}` : ''}
                    </Txt>
                  </RowMeta>
                  <Txt style={[type.rowTime, { whiteSpace: 'nowrap' }]}>{at(e.createdAt)}</Txt>
                </Row>
              ))}
            </List>

            {detail && detail.routingAttempts.length > 0 ? (
              <>
                <Txt style={[type.kvKey, styles.section]}>Routing</Txt>
                <List>
                  {detail.routingAttempts.map((a) => (
                    <Row key={a.sequence}>
                      <RowMeta>
                        <Txt style={[type.rowName, clamp1]}>
                          #{a.sequence} {a.merchantName}
                        </Txt>
                        {a.reason ? <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>{a.reason}</Txt> : null}
                      </RowMeta>
                      <Txt
                        style={{
                          ...mono13,
                          color:
                            a.outcome === 'failed' ? colors.danger
                            : a.outcome === 'released' ? colors.secondary
                            : colors.muted,
                        }}
                      >
                        {a.outcome}
                      </Txt>
                    </Row>
                  ))}
                </List>
              </>
            ) : null}

            {detail?.dispute ? (
              <>
                <Txt style={[type.kvKey, styles.section]}>Dispute</Txt>
                <List>
                  <Row>
                    <RowMeta>
                      <Txt style={[type.rowName, clamp1]}>{detail.dispute.reason ?? 'No reason given'}</Txt>
                      <Txt style={[type.rowTime, { marginTop: 2 }]}>
                        Opened {at(detail.dispute.createdAt)}
                        {detail.dispute.resolvedAt ? ` · resolved ${at(detail.dispute.resolvedAt)}` : ''}
                      </Txt>
                    </RowMeta>
                    <Txt
                      style={{
                        ...mono13,
                        color: detail.dispute.status === 'open' ? colors.danger : colors.muted,
                      }}
                    >
                      {detail.dispute.resolution ?? detail.dispute.status}
                    </Txt>
                  </Row>
                </List>
              </>
            ) : null}

            {detail && detail.transfers.length > 0 ? (
              <>
                <Txt style={[type.kvKey, styles.section]}>Transfers</Txt>
                <List>
                  {detail.transfers.map((t) => (
                    <Row key={t.id}>
                      <RowMeta>
                        <Txt style={[type.rowName, clamp1]}>{t.kind}</Txt>
                        {t.signature ? (
                          <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>{t.signature}</Txt>
                        ) : null}
                      </RowMeta>
                      <Txt
                        style={{
                          ...mono13,
                          color:
                            t.status === 'failed' ? colors.danger
                            : t.status === 'confirmed' ? colors.secondary
                            : colors.muted,
                        }}
                      >
                        {t.status}
                      </Txt>
                    </Row>
                  ))}
                </List>
              </>
            ) : null}
          </>
        ) : (
          <Txt style={type.inst}>{err ?? 'Loading…'}</Txt>
        )}
        {o && err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}
      </View>
    </Screen>
  );
}

const styles = {
  safe: { backgroundColor: colors.canvas },
  head: { paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 6, paddingBottom: 2 },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    paddingLeft: GUTTER,
    paddingRight: GUTTER,
    paddingBottom: 28,
  },
  section: { marginTop: 22, marginBottom: 8 },
} satisfies Record<string, CSSProperties>;
