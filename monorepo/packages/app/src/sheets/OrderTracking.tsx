'use client';

// OrderTracking.tsx — the live tracker: a brand scene that moves with the order (PayScene) + the
// failure-resolution states + the outcome cards. Polls GET /orders/:id until terminal. Every state
// answers "what's happening / what to do / ETA", per the architecture: a user must never wonder
// "did my money disappear?".
import type { CSSProperties, ReactNode } from 'react';
import { useEffect } from 'react';

import { fiatRaw, type OrderResolution } from '@fpay/shared';

import { Btn, colors, fonts, Grab, Icons, Pressable, radii, SheetBody, SheetHeader, Spacer, TextLink, Txt, type, View } from '@fpay/ui';
import { type PayPhase, PayScene } from '../components/PayScene';
import { ResultBlock } from '../components/ResultBlock';
import { platform } from '../platform';
import { usePayStore } from '../store';
import { fmtEta } from './pay';

const RES: Record<OrderResolution, { title: string; body: string }> = {
  delayed: {
    title: 'Taking a little longer',
    body: 'The payout is delayed. We’ve updated the ETA and will keep you posted. Nothing for you to do.',
  },
  needs_action: {
    title: 'Needs your attention',
    body: 'The amount didn’t match. Fix it below and we’ll resume right where you left off.',
  },
  under_review: {
    title: 'Under review',
    body: 'We’re verifying this payout. We’ll resolve it or refund you in full. You won’t be left out of pocket.',
  },
};

// Terminal outcome card — reused for completed / refunded (kind="ok") and failed (kind="no"), so
// every order outcome reads as the same intentional ResultBlock card.
function Outcome({
  kind = 'ok',
  icon,
  title,
  headline,
  inst,
  onClose,
  children,
}: {
  kind?: 'ok' | 'no';
  icon?: ReactNode;
  title: string;
  headline: string;
  inst: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      <Grab />
      <SheetHeader title={title} onClose={onClose} />
      <SheetBody>
        <ResultBlock
          kind={kind}
          icon={icon ?? <Icons.Check size={30} color={colors.accent} />}
          headline={headline}
          inst={inst}
        />
        {children}
        <Spacer />
        <View style={styles.cta}>
          <Btn label="Done" variant="ink" onPress={onClose} />
        </View>
      </SheetBody>
    </>
  );
}

export function OrderTracking() {
  const order = usePayStore((s) => s.order);
  const close = usePayStore((s) => s.close);
  const refreshOrder = usePayStore((s) => s.refreshOrder);
  const disputeOrder = usePayStore((s) => s.disputeOrder);
  const feedbackOrder = usePayStore((s) => s.feedbackOrder);
  const busy = usePayStore((s) => s.busy);

  const terminal = order ? order.state === 'completed' || order.state === 'refunded' || order.state === 'failed' : false;

  // Poll until the order reaches a terminal state.
  useEffect(() => {
    if (!order || terminal) return undefined;
    const t = setInterval(() => void refreshOrder(), 2500);
    return () => clearInterval(t);
  }, [order?.id, terminal, refreshOrder]);

  if (!order) return null;
  // A payment made in parts arrives as `legs` (the primary included); each is its own credit with its
  // own reference and its own recourse. A single payment is just one leg.
  const legs = order.legs ?? [order];
  const parts = legs.length > 1;
  // Recourse, per credit, while its window runs: claimed, not escalating, not yet settled.
  const disputable = legs.filter((l) => l.payoutClaimedAt && !l.resolution && l.state !== 'completed');
  const disputeLinks = disputable.map((leg) => (
    <TextLink
      key={leg.id}
      label={busy ? 'Reporting…' : parts ? `I didn't receive part ${legs.indexOf(leg) + 1}` : "I didn't receive this"}
      onPress={() => void disputeOrder(undefined, leg.id)}
    />
  ));
  // "Paid" the moment every credit is claimed, not when the escrow settles behind it ~2½ minutes
  // later. The receiver has the money at the claim — that is the payer's outcome; what happens to
  // the escrow afterwards is ours. The dispute link stays under the receipt for as long as the
  // window runs, and `completed` is what takes it away.
  const paid =
    order.state === 'completed' ||
    (!!order.payoutClaimedAt && !order.resolution && order.state !== 'refunded' && order.state !== 'failed');
  if (paid) {
    const reached = legs.filter((l) => l.state !== 'refunded' && l.state !== 'failed');
    const returned = legs.filter((l) => l.state === 'refunded');
    const paidFiat = returned.length
      ? reached.reduce((s, l) => s + Number(l.amountFiat ?? 0), 0)
      : order.quote.amountInr;
    return (
      <Outcome
        title="Paid"
        headline={`${fiatRaw(paidFiat, order.quote.currency)} paid`}
        inst={parts ? `Paid from your balance, as ${legs.length} payments` : 'Paid from your balance'}
        onClose={close}
      >
        {/* The reference the payee's own bank shows against the credit. Standing at a counter, this
            is the thing that ends the conversation — the shopkeeper matches it and you leave. A UTR
            identifies the payment, not who sent it, so showing it keeps the LP invisible. */}
        {reached.map((leg) =>
          leg.payoutUtr ? (
            <Pressable
              key={leg.id}
              onPress={() => void platform().copy(leg.payoutUtr!)}
              style={({ pressed }) => [styles.utr, pressed ? { opacity: 0.7 } : null]}
            >
              <Txt style={type.inst}>
                Reference for {order.quote.payoutName ?? 'them'}
                {parts ? ` · ${fiatRaw(leg.amountFiat ?? '0', order.quote.currency)}` : ''}, tap to copy
              </Txt>
              <Txt style={{ ...fonts.mono400, fontSize: 17, color: colors.ink, marginTop: 2 }}>{leg.payoutUtr}</Txt>
            </Pressable>
          ) : null,
        )}
        {returned.map((leg) => (
          <Txt key={leg.id} style={[type.inst, { textAlign: 'center', marginTop: 12 }]}>
            {fiatRaw(leg.amountFiat ?? '0', order.quote.currency)} came back to your balance
          </Txt>
        ))}
        {disputeLinks.length ? <View style={styles.recourse}>{disputeLinks}</View> : null}
        {/* One-tap feedback — never names the merchant (the LP stays invisible per "just pay"). */}
        {order.state !== 'completed' ? null : order.feedbackUp === undefined ? (
          <View style={styles.feedback}>
            <Txt style={type.inst}>Did everything go smoothly?</Txt>
            <View style={styles.thumbs}>
              <Pressable onPress={() => void feedbackOrder(true)} style={({ pressed }) => [styles.thumb, pressed ? { opacity: 0.7 } : null]}>
                <Icons.ThumbUp size={24} />
              </Pressable>
              <Pressable onPress={() => void feedbackOrder(false)} style={({ pressed }) => [styles.thumb, pressed ? { opacity: 0.7 } : null]}>
                <Icons.ThumbDown size={24} />
              </Pressable>
            </View>
          </View>
        ) : (
          <Txt style={[type.inst, { textAlign: 'center', marginTop: 14 }]}>Thanks for letting us know.</Txt>
        )}
      </Outcome>
    );
  }
  if (order.state === 'refunded') {
    return <Outcome title="Refunded" headline={`${fiatRaw(order.quote.amountInr, order.quote.currency)} refunded`} inst="You’ve been made whole" onClose={close} />;
  }
  if (order.state === 'failed') {
    // Terminal failure (e.g. never funded / abandoned) — a clear result card, not a dead-end timeline.
    return (
      <Outcome
        kind="no"
        icon={<Icons.XBig size={28} color={colors.muted} />}
        title="Payment cancelled"
        headline={`${fiatRaw(order.quote.amountInr, order.quote.currency)} not paid`}
        inst="No money left your balance. Please try again."
        onClose={close}
      />
    );
  }

  // Two phases the payer can see: the deposit confirming, then the payout crossing. The claim
  // flips to the Paid card above, so the later states only reach here under a resolution overlay.
  const phase: PayPhase =
    order.state === 'payment_detected' || order.state === 'merchant_confirms' || order.state === 'funds_released' ? 'sending' : 'securing';

  return (
    <>
      <Grab />
      <SheetHeader eyebrow={`Receipt ${order.referenceCode}`} title={`Paying ${fiatRaw(order.quote.amountInr, order.quote.currency)}`} onClose={close} />
      <SheetBody>
        {order.resolution ? (
          <View style={styles.banner}>
            <Txt style={[type.rowAmount, { fontSize: 15 }]}>{RES[order.resolution].title}</Txt>
            <Txt style={[type.inst, { marginTop: 4 }]}>{RES[order.resolution].body}</Txt>
          </View>
        ) : null}

        <PayScene seed={order.id} phase={phase} />
        <Txt style={[type.inst, { textAlign: 'center' }]}>Usually {fmtEta(order.quote.etaMinSecs, order.quote.etaMaxSecs)}.</Txt>

        <Spacer />
        <View style={styles.cta}>
          {/* The payer's half of the trust model: while the recipient hasn't confirmed, they can
              say so. This freezes the release and puts a human on it — and it's what makes the
              merchant's stake mean something. (A single payment that is claimed shows the Paid
              card above instead; this is for a part that is claimed while another is still going.) */}
          {disputeLinks}
          <TextLink label="Run in background" onPress={close} />
        </View>
      </SheetBody>
    </>
  );
}

const styles = {
  banner: { backgroundColor: colors.inkSoft, borderRadius: 16, padding: 16, marginBottom: 6 },
  cta: { gap: 13, alignItems: 'center' },
  utr: { alignItems: 'center', marginTop: 14, padding: 12, borderRadius: radii.card, backgroundColor: colors.surfaceLow },
  recourse: { alignItems: 'center', gap: 10, marginTop: 16 },
  feedback: { alignItems: 'center', gap: 10, marginTop: 14 },
  thumbs: { flexDirection: 'row', gap: 28 },
  thumb: { padding: 8 },
} satisfies Record<string, CSSProperties>;
