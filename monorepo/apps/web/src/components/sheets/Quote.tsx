'use client';

// Quote.tsx — the architecture's "highest-leverage UI": one quote, two choices (Continue / Edit).
// You pay / From balance · Rate · Fee · Network fee · Total time · Payout method · Route quality,
// under a live 45s lock. Continue funds escrow (signs the server-built tx) and opens the timeline.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import type { RouteQuality } from '@pay/shared';

import { Btn, TextLink } from '@/components/ui/Button';
import { Grab, List, SheetBody, SheetHeader, Spacer } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { inrRaw } from '@/lib/money';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

const ROUTE_LABEL: Record<RouteQuality, string> = {
  high: 'High confidence',
  medium: 'Good',
  low: 'Limited',
};

const fmtUsdc = (n: number): string => `${n.toFixed(2)} USDC`;
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
  const merchant = usePayStore((s) => s.merchant);
  const busy = usePayStore((s) => s.busy);
  const error = usePayStore((s) => s.error);
  const close = usePayStore((s) => s.close);
  const confirmOrder = usePayStore((s) => s.confirmOrder);
  const editQuote = usePayStore((s) => s.editQuote);
  const getQuote = usePayStore((s) => s.getQuote);

  // Tick the 45s lock countdown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  if (!quote) return null;
  const secsLeft = Math.max(0, Math.ceil((quote.expiresAt - now) / 1000));
  const expired = secsLeft <= 0;

  return (
    <>
      <Grab />
      <SheetHeader
        eyebrow={`Paying ${merchant.name}`}
        title={expired ? 'Quote expired' : `Quote · valid ${secsLeft}s`}
        onClose={close}
      />
      <SheetBody>
        <View style={styles.headline}>
          <Txt style={[type.bigAmount, { color: colors.ink }]}>{inrRaw(quote.amountInr)}</Txt>
          <Txt style={type.conv}>{fmtUsdc(quote.amountUsdc)} from your balance</Txt>
        </View>

        <List>
          <Line k="Rate" v={`1 USDC = ₹${quote.rate.toFixed(2)}`} />
          <Line k="Fee" v={inrRaw(quote.feeInr)} />
          <Line k="Network fee" v={inrRaw(quote.networkFeeInr)} />
          <Line k="Total time" v={fmtEta(quote.etaMinSecs, quote.etaMaxSecs)} />
          <Line k="Payout method" v={quote.payoutMethod} />
          <Line k="Route quality" v={ROUTE_LABEL[quote.routeQuality]} accent={quote.routeQuality === 'high'} />
        </List>

        <View style={styles.lock}>
          <View style={[styles.dot, expired ? { backgroundColor: colors.muted } : null]} />
          <Txt style={type.inst}>{expired ? 'Rate expired — refresh for a live price' : 'Real price, locked — never stale'}</Txt>
        </View>

        {error ? <Txt style={[type.lead, { color: colors.danger, marginTop: 10 }]}>{error}</Txt> : null}

        <Spacer />
        <View style={styles.cta}>
          {expired ? (
            <Btn label="Refresh quote" onPress={() => getQuote(quote.amountInr)} disabled={busy} />
          ) : (
            <Btn label="Continue" onPress={confirmOrder} disabled={busy} />
          )}
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
