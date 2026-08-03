'use client';

// /merchant — the LP dashboard. Status, stake, and the queue of orders routed to this merchant.
// A different job from the rest of the app: here the user is settling OTHER people's payouts, so
// the screen leads with what they owe and what their stake is worth.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { MerchantOrder } from '@fpay/shared';

import { Icons } from '@/components/icons';
import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { List, Row, RowMeta, Spacer } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { inrRaw, usd } from '@/lib/money';
import { colors, fonts, GUTTER, radii, type } from '@/lib/theme';
import { getMerchantOrders } from '@/services/merchant';
import { usePayStore } from '@/store/usePayStore';

const clamp1: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/** Orders still needing the merchant to act, or still inside their release window. */
const isLive = (o: MerchantOrder) => o.state === 'payment_detected';

function OrderRow({ o, onPress }: { o: MerchantOrder; onPress: () => void }) {
  const claimed = o.payoutClaimedAt != null;
  return (
    <Row onPress={onPress}>
      <RowMeta>
        <Txt style={[type.rowName, clamp1]}>{inrRaw(o.amountInr)}</Txt>
        <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>
          {o.payoutDestination ?? o.payoutName ?? o.referenceCode}
        </Txt>
      </RowMeta>
      <View style={styles.value}>
        <Txt style={{ ...fonts.body500, fontSize: 14, color: statusColor(o) }}>{statusText(o, claimed)}</Txt>
        <Icons.Chevron size={16} color={colors.muted} />
      </View>
    </Row>
  );
}

function StatRow({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <Row>
      <RowMeta>
        <Txt style={type.rowName}>{k}</Txt>
        {sub ? <Txt style={[type.rowTime, { marginTop: 2 }]}>{sub}</Txt> : null}
      </RowMeta>
      <Txt style={type.rowAmount}>{v}</Txt>
    </Row>
  );
}

function statusText(o: MerchantOrder, claimed: boolean): string {
  if (o.state === 'completed') return 'Settled';
  if (o.state === 'merchant_confirms' || o.state === 'funds_released') return 'Releasing';
  if (o.resolution === 'under_review') return 'Disputed';
  return claimed ? 'Releasing' : 'Pay now';
}
function statusColor(o: MerchantOrder): string {
  if (o.resolution === 'under_review') return colors.danger;
  if (o.state === 'completed') return colors.secondary;
  return o.payoutClaimedAt ? colors.muted : colors.accent;
}

export default function MerchantHome() {
  const router = useRouter();
  const merchant = usePayStore((s) => s.merchant);
  const [orders, setOrders] = useState<MerchantOrder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setOrders(await getMerchantOrders());
      setErr(null);
    } catch (e) {
      setErr(friendlyError(e));
    }
  }, []);

  // Same polling shape as the payer's order tracker — new work arrives without a manual refresh.
  useEffect(() => {
    if (!merchant) return undefined;
    void reload();
    const t = setInterval(() => void reload(), 8000);
    return () => clearInterval(t);
  }, [merchant, reload]);

  if (!merchant) {
    return (
      <Screen edges={['top']} style={styles.safe}>
        <View style={styles.head}>
          <BackButton onPress={() => router.push('/home')} />
        </View>
        <View style={styles.scroll}>
          <Txt style={type.handle}>Become a merchant</Txt>
          <Txt style={[type.lead, { marginTop: 10 }]}>
            Merchants settle other people’s payouts and earn a spread. You put up a stake up front.
            If you don’t pay someone, it covers them.
          </Txt>
          <Spacer />
          <Btn label="Apply" variant="ink" onPress={() => router.push('/merchant/apply')} />
        </View>
      </Screen>
    );
  }

  const live = (orders ?? []).filter(isLive);
  const done = (orders ?? []).filter((o) => !isLive(o));
  const belowFloor = merchant.bondUsdc < merchant.minBondUsdc;

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push('/home')} />
      </View>
      <View style={styles.scroll}>
        <Txt style={type.handle}>{merchant.name}</Txt>
        <Txt style={[type.profileSub, { marginTop: 2 }]}>
          {merchant.kybStatus === 'approved' ? statusLabel(merchant.status) : kybLabel(merchant.kybStatus)}
        </Txt>

        {/* The stake is the whole trust model — the most prominent number on the screen. */}
        <Pressable
          onPress={() => router.push('/merchant/stake')}
          style={({ pressed }) => [styles.stakeCard, pressed ? { backgroundColor: colors.surfaceLow } : null]}
        >
          <Txt style={type.kvKey}>Your stake</Txt>
          <Txt style={[type.bigAmount, { fontSize: 34, marginTop: 4 }]}>{usd(merchant.bondUsdc)}</Txt>
          <Txt style={[type.inst, belowFloor ? { color: colors.danger } : null]}>
            {belowFloor
              ? `Below the ${usd(merchant.minBondUsdc)} minimum. No orders until you top up.`
              : `Minimum ${usd(merchant.minBondUsdc)} · tap to add`}
          </Txt>
        </Pressable>

        <List>
          <Row>
            <RowMeta>
              <Txt style={type.rowName}>Capacity</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>Most you can have in flight at once</Txt>
            </RowMeta>
            <Txt style={type.rowAmount}>{usd(merchant.floatUsdc)}</Txt>
          </Row>
          <Row>
            <RowMeta>
              <Txt style={type.rowName}>Settles to</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>{merchant.treasuryAddress}</Txt>
            </RowMeta>
          </Row>
        </List>

        {/* Reputation — the real smoothed numbers routing scores them on, no invented composite. */}
        <Txt style={[type.kvKey, styles.section]}>Reputation</Txt>
        <List>
          <StatRow k="Success rate" v={`${(merchant.successRate * 100).toFixed(1)}%`} />
          <StatRow k="Positive feedback" v={`${(merchant.positiveRate * 100).toFixed(0)}%`} sub="One-tap ratings from people you paid" />
          <StatRow k="Disputes" v={`${(merchant.disputeRate * 100).toFixed(1)}%`} />
          <StatRow k="Completed" v={String((orders ?? []).filter((o) => o.state === 'completed').length)} />
        </List>

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}

        <Txt style={[type.kvKey, styles.section]}>To pay ({live.length})</Txt>
        {orders === null ? (
          <Txt style={type.inst}>Loading…</Txt>
        ) : live.length === 0 ? (
          <Txt style={type.inst}>Nothing waiting. New orders appear here automatically.</Txt>
        ) : (
          <List>
            {live.map((o) => (
              <OrderRow key={o.id} o={o} onPress={() => router.push(`/merchant/orders/${o.id}`)} />
            ))}
          </List>
        )}

        {done.length > 0 ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>Recent</Txt>
            <List>
              {done.slice(0, 10).map((o) => (
                <OrderRow key={o.id} o={o} onPress={() => router.push(`/merchant/orders/${o.id}`)} />
              ))}
            </List>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const statusLabel = (s: string) =>
  s === 'online' ? 'Online, receiving orders' : s === 'suspended' ? 'Suspended' : 'Offline';
const kybLabel = (s: string) =>
  s === 'pending' ? 'Application under review' : s === 'rejected' ? 'Application declined' : s;

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
  stakeCard: { marginTop: 16, marginBottom: 6, padding: 18, borderRadius: radii.card, backgroundColor: colors.surface },
  value: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  section: { marginTop: 22, marginBottom: 8 },
} satisfies Record<string, CSSProperties>;
