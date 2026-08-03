'use client';

// /merchant/orders/[id] — the screen the whole merchant flow exists for.
//
// It shows the ONE thing the rest of the system never recorded until now: the payee's real UPI ID.
// The merchant pays it in their own banking app, comes back, and types the reference. That opens the
// payer's dispute window; when it closes clean the escrow releases to the merchant.
import { useParams, useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { MerchantOrder } from '@fpay/shared';

import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { List, Row, RowMeta, SearchBar, Spacer } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { inrRaw, usd } from '@/lib/money';
import { colors, fonts, GUTTER, radii, type } from '@/lib/theme';
import { getMerchantOrders, markOrderPaid } from '@/services/merchant';

/** Seconds until the escrow auto-releases, or null when nothing is pending. */
function useCountdown(iso?: string): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function MerchantOrder() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<MerchantOrder | null | undefined>(undefined);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // No single-order endpoint — the queue is small and already polled, so filter it rather than add
  // a route (and a query) that exists only to serve one screen.
  const reload = useCallback(async () => {
    try {
      const orders = await getMerchantOrders();
      setOrder(orders.find((o) => o.id === id) ?? null);
    } catch (e) {
      setErr(friendlyError(e));
    }
  }, [id]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 8000);
    return () => clearInterval(t);
  }, [reload]);

  const claimed = order?.payoutClaimedAt != null;
  const secsLeft = useCountdown(claimed ? order?.expiresAt : undefined);

  const submit = async () => {
    if (!order || !reference.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await markOrderPaid(order.id, reference.trim());
      setReference('');
      await reload();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (order === undefined) {
    return (
      <Screen edges={['top']} style={styles.safe}>
        <View style={styles.head}>
          <BackButton onPress={() => router.push('/merchant')} />
        </View>
        <View style={styles.scroll}>
          <Txt style={type.inst}>Loading…</Txt>
        </View>
      </Screen>
    );
  }
  if (order === null) {
    return (
      <Screen edges={['top']} style={styles.safe}>
        <View style={styles.head}>
          <BackButton onPress={() => router.push('/merchant')} />
        </View>
        <View style={styles.scroll}>
          <Txt style={type.lead}>This order is no longer assigned to you.</Txt>
        </View>
      </Screen>
    );
  }

  const vpa = order.payoutDestination;
  // Hands the merchant straight into their own UPI app with the amount pre-filled. Falls back to
  // copy when no app handles the scheme (desktop).
  const deepLink = vpa
    ? `upi://pay?pa=${encodeURIComponent(vpa)}${order.payoutName ? `&pn=${encodeURIComponent(order.payoutName)}` : ''}&am=${order.amountInr}&cu=INR`
    : null;

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push('/merchant')} />
      </View>
      <View style={styles.scroll}>
        <Txt style={type.kvKey}>Pay this person</Txt>
        <Txt style={[type.bigAmount, { marginTop: 6 }]}>{inrRaw(order.amountInr)}</Txt>
        <Txt style={type.conv}>You receive {usd(order.amountUsdc)} when it settles</Txt>

        {vpa ? (
          <Pressable
            onPress={() => void navigator.clipboard?.writeText(vpa)}
            style={({ pressed }) => [styles.vpaCard, pressed ? { backgroundColor: colors.surfaceLow } : null]}
          >
            <Txt style={type.kvKey}>UPI ID, tap to copy</Txt>
            <Txt style={[{ ...fonts.mono400, fontSize: 19, color: colors.ink }, styles.vpa]}>{vpa}</Txt>
            {order.payoutName ? <Txt style={type.inst}>{order.payoutName}</Txt> : null}
          </Pressable>
        ) : (
          <Txt style={[type.lead, { color: colors.danger, marginTop: 16 }]}>
            This order has no payout ID. Don’t pay it, report it instead.
          </Txt>
        )}

        <List>
          <Row>
            <RowMeta>
              <Txt style={type.rowName}>Reference</Txt>
            </RowMeta>
            <Txt style={{ ...fonts.mono400, fontSize: 14, color: colors.muted }}>{order.referenceCode}</Txt>
          </Row>
        </List>

        {claimed ? (
          <View style={styles.claimed}>
            <Txt style={[type.rowAmount, { fontSize: 15 }]}>
              {order.resolution === 'under_review'
                ? 'On hold: the payer reported a problem'
                : secsLeft === 0
                  ? 'Releasing your money…'
                  : `Releases to you in ${mmss(secsLeft ?? 0)}`}
            </Txt>
            <Txt style={[type.inst, { marginTop: 4 }]}>
              {order.resolution === 'under_review'
                ? 'We’re reviewing it. Your stake covers the payer if the money never arrived.'
                : `You reported reference ${order.payoutUtr ?? '—'}.`}
            </Txt>
          </View>
        ) : (
          <>
            {deepLink ? (
              <View style={{ marginTop: 18 }}>
                <Btn label="Open in UPI app" onPress={() => window.location.assign(deepLink)} />
              </View>
            ) : null}
            <Txt style={[type.kvKey, { marginTop: 22, marginBottom: 8 }]}>Once you’ve paid</Txt>
            <SearchBar placeholder="Reference / UTR number" value={reference} onChangeText={setReference} />
            <Txt style={[type.inst, { marginTop: 8 }]}>
              Only mark this paid after the money has actually left your account. Your stake covers the
              payer if it didn’t.
            </Txt>
          </>
        )}

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}

        <Spacer />
        {!claimed ? (
          <Btn
            label={busy ? 'Reporting…' : 'I’ve paid'}
            variant="ink"
            disabled={busy || !reference.trim()}
            onPress={() => void submit()}
          />
        ) : null}
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
  vpaCard: { marginTop: 18, padding: 18, borderRadius: radii.card, backgroundColor: colors.surface },
  vpa: { marginTop: 4, marginBottom: 2, wordBreak: 'break-all' },
  claimed: { marginTop: 18, padding: 16, borderRadius: radii.card, backgroundColor: colors.inkSoft },
} satisfies Record<string, CSSProperties>;
