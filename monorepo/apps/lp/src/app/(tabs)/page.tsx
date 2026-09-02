'use client';

// / — Home: am I taking orders, and what is waiting. Nothing else. Settings live on Account, history on
// Activity; a partner opening the app between orders should see the switch and the queue, not a page.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { MerchantOrder } from '@fpay/shared';
import { usd } from '@fpay/shared';

import { Btn } from '@fpay/ui/Button';
import { List, Row, RowMeta, Spacer } from '@fpay/ui/primitives';
import { ScrollView, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { isHeld, isTakeable, OrderRow } from '@/components/OrderRow';
import { friendlyError } from '@/lib/errors';
import { nextStep } from '@/lib/nextStep';
import { colors, fonts, GUTTER, radii, type } from '@fpay/ui/theme';
import { getMerchantOrders, setMerchantOnline } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

export default function Home() {
  const router = useRouter();
  const merchant = useLpStore((s) => s.merchant);
  const load = useLpStore((s) => s.load);
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

  // A write, then re-read the profile: the switch's state comes from the server, not from the tap.
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

  // Same polling shape as the payer's order tracker — new work arrives without a manual refresh.
  useEffect(() => {
    if (!merchant) return undefined;
    void reload();
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [merchant, reload]);

  if (!merchant) {
    // No partner account. Inline, never a redirect: the profile can be null for a moment (a hard
    // refresh, a failed /me), and bouncing a working partner to /apply for that would be worse.
    return (
      <Screen edges={['top']} style={styles.safe}>
        <ScrollView style={styles.scroll}>
          <Txt style={type.handle}>Become a partner</Txt>
          <Txt style={[type.lead, { marginTop: 10 }]}>
            You pay people in rupees from your own account and get paid back here, plus a spread.
          </Txt>
          <Spacer />
          <Btn label="Apply" variant="ink" onPress={() => router.push('/apply')} />
        </ScrollView>
      </Screen>
    );
  }

  const all = orders ?? [];
  const held = all.filter(isHeld);
  const takeable = all.filter(isTakeable);
  // Number() on both sides: a bare `<` between two decimal STRINGS compares them lexically.
  const belowFloor = Number(merchant.bondUsdc) < Number(merchant.minBondUsdc);
  // Off is always allowed; on needs the same two things the server checks.
  const canToggle =
    merchant.status === 'online' || (merchant.status === 'offline' && merchant.kybStatus === 'approved' && !belowFloor);
  const step = nextStep(merchant);
  const online = merchant.status === 'online';
  const switchLine =
    merchant.status === 'suspended'
      ? merchant.suspendReason === 'exited'
        ? 'You’ve left. No more orders'
        : merchant.suspendReason === 'bond'
          ? 'Below the stake minimum. Top up to come back'
          : 'Suspended. Contact support'
      : online
        ? 'You’ll be offered new orders'
        : merchant.kybStatus !== 'approved'
          ? 'Once your details are approved'
          : belowFloor
            ? `Once your stake is at least ${usd(merchant.minBondUsdc)}`
            : 'Nothing will reach you';

  return (
    <Screen edges={['top']} style={styles.safe}>
      <ScrollView style={styles.scroll}>
        <Txt style={type.handle}>{merchant.name}</Txt>
        <Txt style={[type.profileSub, { marginTop: 2 }]}>{online ? 'Online' : merchant.status === 'suspended' ? 'Suspended' : 'Offline'}</Txt>

        {/* The one thing to do next, as the button. Gone once they are online. */}
        {step ? (
          <View style={styles.notice}>
            <Txt style={type.rowName}>{step.title}</Txt>
            <Txt style={[type.rowTime, { marginTop: 2 }]}>{step.body}</Txt>
            {step.cta ? (
              <Btn
                label={step.cta}
                variant="ink"
                height={44}
                disabled={busy}
                style={{ marginTop: 12 }}
                onPress={() => (step.href ? router.push(step.href) : void toggleOnline())}
              />
            ) : null}
          </View>
        ) : null}

        <List>
          <Row onPress={canToggle ? () => void toggleOnline() : undefined}>
            <RowMeta>
              <Txt style={type.rowName}>Taking orders</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>{switchLine}</Txt>
            </RowMeta>
            <Txt style={{ ...fonts.body500, fontSize: 14, color: online ? colors.secondary : merchant.status === 'suspended' ? colors.danger : colors.muted }}>
              {online ? 'On' : 'Off'}
            </Txt>
          </Row>
        </List>

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}

        {/* Two queues, and the split is the point: what this partner owes someone, and what anyone
            eligible can still take. */}
        <Txt style={[type.kvKey, styles.section]}>To pay ({held.length})</Txt>
        {orders === null ? (
          <Txt style={type.inst}>Loading…</Txt>
        ) : held.length === 0 ? (
          <Txt style={type.inst}>Nothing on you right now.</Txt>
        ) : (
          <List>
            {held.map((o) => (
              <OrderRow key={o.id} o={o} onPress={() => router.push(`/orders/${o.id}`)} />
            ))}
          </List>
        )}

        <Txt style={[type.kvKey, styles.section]}>Up for grabs ({takeable.length})</Txt>
        {orders === null ? null : takeable.length === 0 ? (
          <Txt style={type.inst}>{online ? 'Nothing waiting. We’ll ping you the moment something lands.' : 'You’re offline, so nothing is being offered to you.'}</Txt>
        ) : (
          <List>
            {takeable.map((o) => (
              <OrderRow key={o.id} o={o} onPress={() => router.push(`/orders/${o.id}`)} />
            ))}
          </List>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  safe: { backgroundColor: colors.canvas },
  scroll: { paddingTop: 14, paddingLeft: GUTTER, paddingRight: GUTTER, paddingBottom: 28 },
  notice: { marginTop: 14, marginBottom: 10, padding: 14, borderRadius: radii.card, backgroundColor: colors.surfaceLow },
  section: { marginTop: 22, marginBottom: 8 },
} satisfies Record<string, CSSProperties>;
