'use client';

// /orders/[id] — the screen the whole merchant flow exists for.
//
// It shows the ONE thing the rest of the system never recorded until now: the payee's real UPI ID.
// The merchant pays it in their own banking app, comes back, and types the reference. That opens the
// payer's dispute window; when it closes clean the escrow releases to the merchant.
import { useParams, useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { MerchantOrder } from '@fpay/shared';
import { vpaOperator } from '@fpay/shared';

import { BackButton } from '@fpay/ui/BackButton';
import { Btn } from '@fpay/ui/Button';
import { List, Row, RowMeta, SearchBar, Spacer } from '@fpay/ui/primitives';
import { Pressable, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { fiatRaw, usd } from '@fpay/shared';
import { colors, fonts, GUTTER, radii, type } from '@fpay/ui/theme';
import { getMerchantOrders, lockOrder, markOrderPaid, unlockOrder } from '@/services/merchant';

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

/** Mirrors LOCK_TTL_MS in services/orderMachine.ts — copy shown to the LP before they commit, so
 *  it only has to be roughly right; the server's timer is the one that decides. */
const LOCK_MINUTES = 5;

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
  // Two different clocks, and they must not be confused. Once claimed, expiresAt is the payer's
  // dispute window counting down to the LP's money. Before that, lockExpiresAt is how long the LP
  // has to actually pay before the order goes back to the pool.
  const held = order?.lockedAt != null;
  const secsLeft = useCountdown(claimed ? order?.expiresAt : held ? order?.lockExpiresAt : undefined);

  /** Take the order. Until this succeeds nobody — including this LP — has been told who to pay. */
  const take = async () => {
    if (!order) return;
    setBusy(true);
    setErr(null);
    try {
      await lockOrder(order.id);
      await reload();
    } catch (e) {
      setErr(friendlyError(e));
      await reload(); // someone else got it; show that rather than a stale "take it" button
    } finally {
      setBusy(false);
    }
  };

  const giveBack = async () => {
    if (!order) return;
    setBusy(true);
    setErr(null);
    try {
      await unlockOrder(order.id);
      router.push('/');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

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
          <BackButton onPress={() => router.push('/')} />
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
          <BackButton onPress={() => router.push('/')} />
        </View>
        <View style={styles.scroll}>
          <Txt style={type.lead}>Someone else took this one.</Txt>
        </View>
      </Screen>
    );
  }

  const vpa = order.payoutDestination;
  // Hands the merchant straight into their own UPI app with the amount pre-filled. Falls back to
  // copy when no app handles the scheme (desktop). UPI-only: QRIS has no equivalent public URI
  // scheme — an Indonesian LP copies the NMID and pays from their own banking/e-wallet app.
  const deepLink = vpa && order.payoutMethod === 'UPI'
    ? `upi://pay?pa=${encodeURIComponent(vpa)}${order.payoutName ? `&pn=${encodeURIComponent(order.payoutName)}` : ''}&am=${order.amountInr}&cu=INR`
    : null;

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push('/')} />
      </View>
      <View style={styles.scroll}>
        <Txt style={type.kvKey}>Pay this person</Txt>
        <Txt style={[type.bigAmount, { marginTop: 6 }]}>{fiatRaw(order.amountInr, order.currency)}</Txt>
        <Txt style={type.conv}>You receive {usd(order.amountUsdc)} when it settles</Txt>

        {vpa ? (
          <Pressable
            onPress={() => void navigator.clipboard?.writeText(vpa)}
            style={({ pressed }) => [styles.vpaCard, pressed ? { backgroundColor: colors.surfaceLow } : null]}
          >
            <Txt style={type.kvKey}>{order.payoutMethod === 'QRIS' ? 'QRIS merchant ID, tap to copy' : 'UPI ID, tap to copy'}</Txt>
            <Txt style={[{ ...fonts.mono400, fontSize: 19, color: colors.ink }, styles.vpa]}>{vpa}</Txt>
            {order.payoutName ? <Txt style={type.inst}>{order.payoutName}</Txt> : null}
            {/* Which app/bank processes this VPA (@okaxis → Google Pay) — tells the merchant what
                the payee's side looks like before they pay a stranger's ID. */}
            {vpaOperator(vpa) ? <Txt style={type.inst}>Processed by {vpaOperator(vpa)!.name}</Txt> : null}
          </Pressable>
        ) : held ? (
          // Held but no payee: the order lost its destination somehow. Never invite a payment.
          <Txt style={[type.lead, { color: colors.danger, marginTop: 16 }]}>
            This order has no payout ID. Don’t pay it, report it instead.
          </Txt>
        ) : (
          // NOT held — so the server hasn't told us who to pay, and won't until this LP commits.
          // That is the entire point of the lock: whoever takes it is the only one who can see the
          // payee, so two people can never pay the same person for the same order.
          <View style={styles.vpaCard}>
            <Txt style={type.kvKey}>Who to pay</Txt>
            <Txt style={[type.lead, { marginTop: 4 }]}>
              Take this order and we’ll show you. It’s yours for {Math.round(LOCK_MINUTES)} minutes — nobody
              else can pay it while you hold it.
            </Txt>
          </View>
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
            {/* What an LP under dispute can actually DO. Before this the entire experience of
                losing 1,500 USDC of bond was the sentence above — no way to say "here is the
                proof", which is the one thing they have and we don't. */}
            {order.resolution === 'under_review' ? (
              <Txt style={[type.inst, { marginTop: 8 }]}>
                If you have proof this was paid — a bank reference or screenshot — send it to support
                with {order.referenceCode}. That’s what decides it.
              </Txt>
            ) : null}
          </View>
        ) : held ? (
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
            {secsLeft != null && secsLeft > 0 ? (
              <Txt style={[type.inst, { marginTop: 8, color: secsLeft < 60 ? colors.danger : colors.muted }]}>
                Yours for {mmss(secsLeft)}. After that it goes back to everyone — don’t pay it once it does.
              </Txt>
            ) : null}
          </>
        ) : null}

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}

        <Spacer />
        {claimed ? null : held ? (
          <>
            <Btn
              label={busy ? 'Reporting…' : 'I’ve paid'}
              variant="ink"
              disabled={busy || !reference.trim()}
              onPress={() => void submit()}
            />
            {/* The honest exit. It has to be here and it has to be free: if giving an order back
                costs the same as going quiet, everyone goes quiet and the pool waits out every TTL. */}
            <Pressable onPress={() => void giveBack()} disabled={busy}>
              <Txt style={[type.rowTime, { marginTop: 12, textAlign: 'center', color: colors.accent }]}>
                Can’t pay this one — give it back
              </Txt>
            </Pressable>
          </>
        ) : (
          <Btn
            label={busy ? 'Taking…' : 'Take this order'}
            variant="ink"
            disabled={busy}
            onPress={() => void take()}
          />
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
  vpaCard: { marginTop: 18, padding: 18, borderRadius: radii.card, backgroundColor: colors.surface },
  vpa: { marginTop: 4, marginBottom: 2, wordBreak: 'break-all' },
  claimed: { marginTop: 18, padding: 16, borderRadius: radii.card, backgroundColor: colors.inkSoft },
} satisfies Record<string, CSSProperties>;
