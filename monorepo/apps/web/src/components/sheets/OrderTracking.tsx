'use client';

// OrderTracking.tsx — the live 7-step order timeline + the four failure-resolution states.
// Polls GET /orders/:id until terminal. Every state answers "what's happening / what to do / ETA",
// per the architecture: a user must never wonder "did my money disappear?".
import type { CSSProperties, ReactNode } from 'react';
import { useEffect } from 'react';

import type { OrderResolution, OrderState } from '@fpay/shared';

import { Icons } from '@/components/icons';
import { ResultBlock } from '@/components/ResultBlock';
import { Btn, TextLink } from '@/components/ui/Button';
import { Grab, SheetBody, SheetHeader, Spacer } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { fiatRaw } from '@/lib/money';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

const STEPS: { state: OrderState; label: string; sub: string }[] = [
  { state: 'quote_locked', label: 'Quote locked', sub: 'Rate & fee locked in' },
  { state: 'pay_instructions', label: 'Confirm payment', sub: 'Tap confirm to pay' },
  { state: 'waiting_payment', label: 'Processing payment', sub: 'Securing your money' },
  { state: 'payment_detected', label: 'Payment secured', sub: 'Your money is held safely' },
  { state: 'merchant_confirms', label: 'Paying the recipient', sub: 'Sending it across' },
  { state: 'funds_released', label: 'Payment sent', sub: 'Almost done' },
  { state: 'completed', label: 'Completed', sub: 'All done' },
];

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

function Step({ label, sub, status }: { label: string; sub: string; status: 'done' | 'active' | 'todo' }) {
  const lit = status !== 'todo';
  return (
    <View style={stepStyles.row}>
      <View style={[stepStyles.dot, lit ? { backgroundColor: colors.accent } : null, status === 'active' ? stepStyles.dotActive : null]} />
      <View style={{ flex: 1 }}>
        <Txt style={[type.rowAmount, { fontSize: 15 }, status === 'todo' ? { color: colors.muted } : null]}>{label}</Txt>
        {status === 'active' ? <Txt style={type.inst}>{sub}</Txt> : null}
      </View>
    </View>
  );
}

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
  if (order.state === 'completed') {
    return (
      <Outcome title="Paid" headline={`${fiatRaw(order.quote.amountInr, order.quote.currency)} paid`} inst="Paid from your balance" onClose={close}>
        {/* One-tap feedback — never names the merchant (the LP stays invisible per "just pay"). */}
        {order.feedbackUp === undefined ? (
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

  const idx = STEPS.findIndex((s) => s.state === order.state);

  return (
    <>
      <Grab />
      <SheetHeader eyebrow={`Receipt ${order.referenceCode}`} title="Tracking your payment" onClose={close} />
      <SheetBody>
        {order.resolution ? (
          <View style={styles.banner}>
            <Txt style={[type.rowAmount, { fontSize: 15 }]}>{RES[order.resolution].title}</Txt>
            <Txt style={[type.inst, { marginTop: 4 }]}>{RES[order.resolution].body}</Txt>
          </View>
        ) : null}

        <View style={styles.steps}>
          {STEPS.map((s, i) => (
            <Step key={s.state} label={s.label} sub={s.sub} status={i < idx ? 'done' : i === idx ? 'active' : 'todo'} />
          ))}
        </View>

        <Spacer />
        <View style={styles.cta}>
          {/* The payer's half of the trust model: while the recipient hasn't confirmed, they can
              say so. This freezes the release and puts a human on it — and it's what makes the
              merchant's stake mean something. */}
          {order.payoutClaimedAt && !order.resolution ? (
            <TextLink
              label={busy ? 'Reporting…' : "I didn't receive this"}
              onPress={() => void disputeOrder()}
            />
          ) : null}
          <TextLink label="Run in background" onPress={close} />
        </View>
      </SheetBody>
    </>
  );
}

const stepStyles = {
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 9, paddingBottom: 9 },
  dot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.inkSoft, marginTop: 4, flexShrink: 0 },
  dotActive: { boxShadow: `0 0 0 4px ${colors.accentSoft}` },
} satisfies Record<string, CSSProperties>;

const styles = {
  banner: { backgroundColor: colors.inkSoft, borderRadius: 16, padding: 16, marginBottom: 6 },
  steps: { marginTop: 8 },
  cta: { gap: 13, alignItems: 'center' },
  feedback: { alignItems: 'center', gap: 10, marginTop: 14 },
  thumbs: { flexDirection: 'row', gap: 28 },
  thumb: { padding: 8 },
} satisfies Record<string, CSSProperties>;
