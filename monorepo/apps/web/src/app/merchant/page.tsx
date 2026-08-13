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
import { fiatRaw, usd } from '@/lib/money';
import { colors, fonts, GUTTER, radii, type } from '@/lib/theme';
import {
  cancelStakeWithdrawal,
  getMerchantOrders,
  requestStakeWithdrawal,
  setMerchantFloat,
  setMerchantOnline,
  setMerchantSpread,
} from '@/services/merchant';
import { usePayStore } from '@/store/usePayStore';

const clamp1: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/** Orders still needing the merchant to act, or still inside their release window. */
const isLive = (o: MerchantOrder) => o.state === 'payment_detected';

function OrderRow({ o, onPress }: { o: MerchantOrder; onPress: () => void }) {
  const claimed = o.payoutClaimedAt != null;
  return (
    <Row onPress={onPress}>
      <RowMeta>
        <Txt style={[type.rowName, clamp1]}>{fiatRaw(o.amountInr, o.currency)}</Txt>
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
  const load = usePayStore((s) => s.load);
  const [orders, setOrders] = useState<MerchantOrder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setOrders(await getMerchantOrders());
      setErr(null);
    } catch (e) {
      setErr(friendlyError(e));
    }
  }, []);

  /**
   * Run a settings write, then re-read the profile. `load()` is the refresh, not a local setState:
   * MerchantProfile rides on /me, and several of these fields are recomputed server-side (capacity
   * is capped against the stake, a withdrawal moves the bond) — echoing the request back would show
   * the LP what they asked for rather than what they got.
   */
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        setErr(null);
        await load();
      } catch (e) {
        setErr(friendlyError(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  const toggleOnline = () => act(() => setMerchantOnline(merchant?.status !== 'online'));

  // window.prompt, deliberately: these are rare, numeric, single-field edits by the one person who
  // runs this account. A bottom sheet each would be three new SheetIds and three new components for
  // three number entries. Revisit if LPs edit these often enough to notice.
  const editCapacity = () => {
    const raw = window.prompt('Most you can have in flight at once, in dollars', String(Number(merchant?.floatUsdc ?? 0)));
    if (raw == null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return setErr('Enter a number, like 5000.');
    return act(() => setMerchantFloat(n));
  };

  const editSpread = () => {
    const raw = window.prompt('Your margin, as a percent (0.10 to 3.00)', ((merchant?.spreadBps ?? 50) / 100).toFixed(2));
    if (raw == null) return;
    const pct = Number(raw);
    if (!Number.isFinite(pct)) return setErr('Enter a percent, like 0.50.');
    return act(() => setMerchantSpread(Math.round(pct * 100)));
  };

  const withdraw = () => {
    const raw = window.prompt('How much of your stake to take back, in dollars');
    if (raw == null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return setErr('Enter an amount, like 500.');
    return act(() => requestStakeWithdrawal(n));
  };

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
  // Number() on both sides: a bare `<` between two decimal STRINGS compares them lexically, so
  // "900.000000" would read as above a "2000.000000" floor and the warning would never show.
  const belowFloor = Number(merchant.bondUsdc) < Number(merchant.minBondUsdc);

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
              : `Minimum ${usd(merchant.minBondUsdc)} · tap to add · backs ${usd(merchant.maxFloatUsdc)} of work`}
          </Txt>
        </Pressable>
        {!merchant.pendingWithdrawal && Number(merchant.bondUsdc) > 0 ? (
          <Pressable onPress={() => void withdraw()}>
            <Txt style={[type.rowTime, { marginTop: 2, marginBottom: 8, color: colors.accent }]}>
              Take some back
            </Txt>
          </Pressable>
        ) : null}

        {merchant.pendingWithdrawal ? (
          <View style={styles.notice}>
            <Txt style={[type.rowName, { color: colors.accent }]}>
              {usd(merchant.pendingWithdrawal.amountUsdc)} on its way back
            </Txt>
            <Txt style={[type.rowTime, { marginTop: 2 }]}>
              Already taken off your stake. We send it by hand — usually within a day.
            </Txt>
            <Pressable onPress={() => void act(() => cancelStakeWithdrawal(merchant.pendingWithdrawal!.id))}>
              <Txt style={[type.rowTime, { marginTop: 8, color: colors.accent }]}>Cancel and put it back</Txt>
            </Pressable>
          </View>
        ) : null}

        <List>
          {/* Availability. Until now `merchants.status` was admin-only and the documented workaround
              was setting capacity to zero — which says "I have no money", not "I'm asleep", and
              routing reads those very differently. */}
          <Row onPress={merchant.kybStatus === 'approved' ? () => void toggleOnline() : undefined}>
            <RowMeta>
              <Txt style={type.rowName}>Taking orders</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>
                {merchant.status === 'suspended'
                  ? 'Suspended — contact support'
                  : merchant.status === 'online'
                    ? 'You’ll be offered new orders'
                    : 'Nothing will reach you'}
              </Txt>
            </RowMeta>
            <Txt style={{ ...fonts.body500, fontSize: 14, color: onlineColor(merchant.status) }}>
              {merchant.status === 'online' ? 'On' : 'Off'}
            </Txt>
          </Row>
          <Row onPress={() => void editCapacity()}>
            <RowMeta>
              <Txt style={type.rowName}>Capacity</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>
                {/* Number() on both sides — these are decimal strings, and a lexical compare would
                    read "900.000000" as larger than "15000.000000". */}
                {Number(merchant.floatUsdc) > Number(merchant.maxFloatUsdc)
                  ? `Capped at ${usd(merchant.maxFloatUsdc)} by your stake`
                  : 'Most you can have in flight at once'}
              </Txt>
            </RowMeta>
            <Txt style={type.rowAmount}>
              {usd(Math.min(Number(merchant.floatUsdc), Number(merchant.maxFloatUsdc)))}
            </Txt>
          </Row>
          <Row onPress={() => void editSpread()}>
            <RowMeta>
              <Txt style={type.rowName}>Your margin</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>What you keep per payout. Lower wins more work.</Txt>
            </RowMeta>
            <Txt style={type.rowAmount}>{(merchant.spreadBps / 100).toFixed(2)}%</Txt>
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
const onlineColor = (s: string) =>
  s === 'online' ? colors.secondary : s === 'suspended' ? colors.danger : colors.muted;
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
  notice: { marginTop: 6, marginBottom: 10, padding: 14, borderRadius: radii.card, backgroundColor: colors.surfaceLow },
  value: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  section: { marginTop: 22, marginBottom: 8 },
} satisfies Record<string, CSSProperties>;
