'use client';

// Quote.tsx — the "highest-leverage UI": one quote, two choices (Continue / Edit).
// You pay / from balance · today's rate · fee · total time · payout method. The rate hold is
// invisible: the quote silently re-fetches near expiry, so the ₹ amount the user typed never
// changes — only the internal rate/USDC recalculate. Continue confirms and opens the tracker.
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

import { Btn, TextLink } from '@/components/ui/Button';
import { Grab, List, SheetBody, SheetHeader, Spacer } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { vpaOperator } from '@fpay/shared';

import { fiatRaw, usd } from '@/lib/money';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

const operatorLabel = (method: string, destination?: string): string => {
  const op = destination ? vpaOperator(destination) : undefined;
  return op ? `${method} · via ${op.name}` : method;
};

const fmtEta = (minSecs: number, maxSecs: number): string =>
  maxSecs < 90 ? `${minSecs}–${maxSecs} sec` : `${Math.round(minSecs / 60)}–${Math.round(maxSecs / 60)} min`;

function Line({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <View style={lineStyle}>
      <Txt style={type.kvKey}>{k}</Txt>
      <Txt style={[type.rowAmount, { fontSize: 14.5 }, accent ? { color: colors.accent } : null]}>{v}</Txt>
    </View>
  );
}
const lineStyle: CSSProperties = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: 13,
  paddingBottom: 13,
  paddingLeft: 16,
  paddingRight: 16,
};

export function QuoteSheet() {
  const quote = usePayStore((s) => s.quote);
  const payee = usePayStore((s) => s.payee);
  const busy = usePayStore((s) => s.busy);
  const error = usePayStore((s) => s.error);
  const close = usePayStore((s) => s.close);
  const confirmOrder = usePayStore((s) => s.confirmOrder);
  const editQuote = usePayStore((s) => s.editQuote);
  const refreshQuote = usePayStore((s) => s.refreshQuote);

  // Keep the quote fresh under the user — the store no-ops until near expiry, then swaps the
  // quote in place. Also self-heals after background-tab throttling: first tick back refreshes.
  useEffect(() => {
    const t = setInterval(() => void refreshQuote(), 1000);
    return () => clearInterval(t);
  }, [refreshQuote]);

  if (!quote) return null;

  return (
    <>
      <Grab />
      <SheetHeader eyebrow={`Paying ${payee.name}`} title="Review payment" onClose={close} />
      <SheetBody>
        <View style={styles.headline}>
          <Txt style={[type.bigAmount, { color: colors.ink }]}>{fiatRaw(quote.amountInr, quote.currency)}</Txt>
          <Txt style={type.conv}>{usd(quote.amountUsdc)} from your balance</Txt>
        </View>

        <List>
          {/* Show the destination the payment will actually reach. This is the anti-wrong-send
              confirmation every UPI app does — the last chance to catch a bad scan. */}
          {quote.payoutDestination ? <Line k="Paying to" v={quote.payoutDestination} /> : null}
          <Line k="Today's rate" v={`$1 = ${fiatRaw(quote.rate, quote.currency)}`} />
          {/* Number() both legs: these are decimal STRINGS on the wire, and `+` on two strings
              concatenates — "40.00" + "8.00" would render as ₹40.008. */}
          <Line k="Fee" v={fiatRaw(Number(quote.feeInr) + Number(quote.networkFeeInr), quote.currency)} />
          <Line k="Total time" v={fmtEta(quote.etaMinSecs, quote.etaMaxSecs)} />
          {/* Name the operator behind the VPA suffix when known (@okaxis → Google Pay) — part of
              the same anti-wrong-send confirmation as the destination line above. */}
          <Line k="Payout method" v={operatorLabel(quote.payoutMethod, quote.payoutDestination)} />
        </List>

        <View style={styles.lock}>
          <View style={styles.dot} />
          <Txt style={type.inst}>Real price, locked. Never stale</Txt>
        </View>

        {error ? <Txt style={[type.lead, { color: colors.danger, marginTop: 10 }]}>{error}</Txt> : null}

        <Spacer />
        <View style={styles.cta}>
          <Btn label="Continue" onPress={confirmOrder} disabled={busy} />
          <TextLink label="Edit" onPress={editQuote} />
        </View>
      </SheetBody>
    </>
  );
}

const styles = {
  headline: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 8, paddingBottom: 20 },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.accent },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
