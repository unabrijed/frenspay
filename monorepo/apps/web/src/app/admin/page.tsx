'use client';

// /admin — read-only flow visibility for the operator. What happened where: order counts,
// everything currently needing a human (disputes, stuck orders, risk flags, merchant alerts),
// and the cross-user order list. Raw state names on purpose — this is the operator's page,
// not the de-cryptoed consumer UX. The backend 403s non-admins; that IS the gate.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { AdminOrder, AdminOrdersResponse, AdminOverviewResponse } from '@fpay/shared';

import { Icons } from '@/components/icons';
import { BackButton } from '@/components/ui/BackButton';
import { List, Row, RowMeta } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { usd } from '@/lib/money';
import { colors, fonts, GUTTER, radii, type } from '@/lib/theme';
import { api, ApiError } from '@/services/api';
import { relTime } from '@/services/mappers';

const FILTERS = ['All', 'Live', 'Issues', 'Failed', 'Done'] as const;
type Filter = (typeof FILTERS)[number];

const clamp1: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const isDone = (o: AdminOrder) => o.state === 'completed' || o.state === 'refunded';
const hasIssue = (o: AdminOrder) => o.resolution != null || o.state === 'failed';

const matches = (o: AdminOrder, f: Filter): boolean =>
  f === 'All' ? true
  : f === 'Live' ? !isDone(o) && o.state !== 'failed'
  : f === 'Issues' ? hasIssue(o)
  : f === 'Failed' ? o.state === 'failed'
  : isDone(o);

function stateColor(state: string, resolution: string | null): string {
  if (state === 'failed' || resolution === 'under_review') return colors.danger;
  if (resolution) return colors.accent;
  if (state === 'completed') return colors.secondary;
  if (state === 'refunded') return colors.muted;
  return colors.ink;
}

const mono13: CSSProperties = { ...fonts.mono400, fontSize: 13 };

function OrderRow({ o, onPress }: { o: AdminOrder; onPress: () => void }) {
  return (
    <Row onPress={onPress}>
      <RowMeta>
        <Txt style={[type.rowName, clamp1]}>
          {o.userHandle} → {o.merchantName}
        </Txt>
        <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>
          {usd(o.amountUsdc)} · {relTime(o.createdAt)}
        </Txt>
      </RowMeta>
      <View style={styles.value}>
        <Txt style={{ ...mono13, color: stateColor(o.state, o.resolution) }}>
          {o.state}
          {o.resolution ? ` · ${o.resolution}` : ''}
        </Txt>
        <Icons.Chevron size={16} color={colors.muted} />
      </View>
    </Row>
  );
}

export default function AdminHome() {
  const router = useRouter();
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [orders, setOrders] = useState<AdminOrdersResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [f, setF] = useState<Filter>('All');

  const reload = useCallback(async () => {
    try {
      const [ov, os] = await Promise.all([api.adminOverview(), api.adminOrders()]);
      setOverview(ov);
      setOrders(os);
      setErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setDenied(true);
      else setErr(friendlyError(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 8000);
    return () => clearInterval(t);
  }, [reload]);

  if (denied) {
    return (
      <Screen edges={['top']} style={styles.safe}>
        <View style={styles.head}>
          <BackButton onPress={() => router.back()} />
        </View>
        <View style={styles.scroll}>
          <Txt style={type.handle}>Not authorized</Txt>
          <Txt style={[type.lead, { marginTop: 10 }]}>This page is for the fpay operator.</Txt>
        </View>
      </Screen>
    );
  }

  const shown = (orders?.orders ?? []).filter((o) => matches(o, f));
  const counts = overview?.orderCounts ?? {};
  const issueCount =
    (overview?.openDisputes.length ?? 0) +
    (overview?.stuckOrders.length ?? 0) +
    (overview?.riskFlags.length ?? 0) +
    (overview?.merchantAlerts.length ?? 0);

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.back()} />
      </View>
      <View style={styles.scroll}>
        <Txt style={type.handle}>Admin</Txt>
        <Txt style={[type.profileSub, { marginTop: 2 }]}>
          {overview ? (issueCount === 0 ? 'All clear — nothing needs a human.' : `${issueCount} item(s) need attention`) : 'Loading…'}
        </Txt>

        {/* Order counts by state — the one-glance pulse. */}
        {overview ? (
          <View style={styles.countsWrap}>
            {Object.entries(counts).map(([state, n]) => (
              <View key={state} style={styles.countPill}>
                <Txt style={{ ...mono13, color: stateColor(state, null) }}>
                  {state} {n}
                </Txt>
              </View>
            ))}
            {overview.failedBridgeCount > 0 ? (
              <View style={styles.countPill}>
                <Txt style={{ ...mono13, color: colors.danger }}>bridge_failed {overview.failedBridgeCount}</Txt>
              </View>
            ) : null}
          </View>
        ) : null}

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}

        {overview && overview.openDisputes.length > 0 ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>Open disputes</Txt>
            <List>
              {overview.openDisputes.map((d) => (
                <Row key={d.id} onPress={() => router.push(`/admin/orders/${d.orderId}`)}>
                  <RowMeta>
                    <Txt style={[type.rowName, clamp1]}>{d.merchantName}</Txt>
                    <Txt style={[type.rowTime, { marginTop: 2 }]}>
                      {usd(d.amountUsdc)} · {relTime(d.createdAt)}
                    </Txt>
                  </RowMeta>
                  <View style={styles.value}>
                    <Txt style={{ ...mono13, color: colors.danger }}>open</Txt>
                    <Icons.Chevron size={16} color={colors.muted} />
                  </View>
                </Row>
              ))}
            </List>
          </>
        ) : null}

        {overview && overview.stuckOrders.length > 0 ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>Stuck orders</Txt>
            <List>
              {overview.stuckOrders.map((o) => (
                <Row key={o.id} onPress={() => router.push(`/admin/orders/${o.id}`)}>
                  <RowMeta>
                    <Txt style={[type.rowName, clamp1]}>{o.userHandle}</Txt>
                    <Txt style={[type.rowTime, { marginTop: 2 }]}>
                      {usd(o.amountUsdc)} · {relTime(o.updatedAt)}
                    </Txt>
                  </RowMeta>
                  <View style={styles.value}>
                    <Txt style={{ ...mono13, color: stateColor(o.state, o.resolution) }}>
                      {o.state} · {o.resolution}
                    </Txt>
                    <Icons.Chevron size={16} color={colors.muted} />
                  </View>
                </Row>
              ))}
            </List>
          </>
        ) : null}

        {overview && overview.riskFlags.length > 0 ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>Risk flags</Txt>
            <List>
              {overview.riskFlags.map((r) => (
                <Row key={r.id}>
                  <RowMeta>
                    <Txt style={[type.rowName, clamp1]}>
                      {r.userHandle ?? 'unknown'} · {r.kind}
                    </Txt>
                    <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>
                      {r.amountUsdc != null ? `${usd(r.amountUsdc)} · ` : ''}
                      {r.reason ?? 'no reason recorded'} · {relTime(r.createdAt)}
                    </Txt>
                  </RowMeta>
                  <Txt style={{ ...mono13, color: r.decision === 'block' ? colors.danger : colors.accent }}>{r.decision}</Txt>
                </Row>
              ))}
            </List>
          </>
        ) : null}

        {overview && overview.merchantAlerts.length > 0 ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>Merchant alerts</Txt>
            <List>
              {overview.merchantAlerts.map((m) => (
                <Row key={m.id}>
                  <RowMeta>
                    <Txt style={[type.rowName, clamp1]}>{m.name}</Txt>
                  </RowMeta>
                  <Txt style={{ ...mono13, color: m.status === 'suspended' ? colors.danger : colors.accent }}>
                    {m.status === 'suspended' ? 'suspended' : `kyb ${m.kybStatus}`}
                  </Txt>
                </Row>
              ))}
            </List>
          </>
        ) : null}

        <Txt style={[type.kvKey, styles.section]}>Orders</Txt>
        <View style={styles.filters}>
          {FILTERS.map((x) => (
            <Pressable key={x} onPress={() => setF(x)} style={[styles.f, f === x && styles.fOn]}>
              <Txt style={[type.filter, { color: f === x ? colors.white : colors.ink }]}>{x}</Txt>
            </Pressable>
          ))}
        </View>
        {orders === null ? (
          <Txt style={type.inst}>Loading…</Txt>
        ) : shown.length === 0 ? (
          <Txt style={type.inst}>No orders here.</Txt>
        ) : (
          <List>
            {shown.map((o) => (
              <OrderRow key={o.id} o={o} onPress={() => router.push(`/admin/orders/${o.id}`)} />
            ))}
          </List>
        )}
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
  countsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  countPill: {
    paddingTop: 5,
    paddingBottom: 5,
    paddingLeft: 10,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surface,
  },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 12 },
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
  value: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  section: { marginTop: 22, marginBottom: 8 },
} satisfies Record<string, CSSProperties>;
