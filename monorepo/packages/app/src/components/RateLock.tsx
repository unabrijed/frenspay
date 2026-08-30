// RateLock — the signature element. Three approved variants; default Columns (A).
// Appears on Review, Success, and Transaction detail. Web port of screens-core.jsx.
import type { CSSProperties } from 'react';

import { colors, Icons, radii, shadows, type St, Txt, type, View } from '@fpay/ui';
import { inrRaw, rateLabel, usd } from '@fpay/shared';
import { usePayStore } from '../store';

export type RlcVariant = 'A' | 'B' | 'C';

function Lock({ center }: { center?: boolean }) {
  // The signature element said '1 USD = 87.55 INR' on every review and success screen,
  // regardless of what the order was actually priced at.
  const fxRate = usePayStore((s) => s.fxRate);
  return (
    <>
      <View style={s.divider} />
      <View style={[s.lock, center && { justifyContent: 'center', gap: 12 }] as St[]}>
        <View style={s.lockL}>
          <View style={s.dot} />
          <Txt style={s.lockLabel}>Rate locked</Txt>
        </View>
        <Txt style={type.rateLine}>{rateLabel(fxRate)}</Txt>
      </View>
    </>
  );
}

// "They get", not "Merchant gets": this line is the PAYEE — the shop or person being paid — and
// calling them the merchant collides with the `merchants` table, which is the LP settling the leg.
// The payer must never perceive that second party at all, so the word doesn't belong on their
// screen in either sense. (contracts.ts:17-23 makes the same distinction: the payee is `Payee`.)
export function RateLock({ variant = 'A', payUsd, getR }: { variant?: RlcVariant; payUsd: number; getR: number }) {
  if (variant === 'B') {
    return (
      <View style={[s.card, s.padB]}>
        <Txt style={type.rlcMicro}>You pay</Txt>
        <Txt style={[type.rlcFigB, { color: colors.ink, marginTop: 6 }]}>{usd(payUsd)}</Txt>
        <View style={s.arrow}>
          <View style={s.arrowChip}>
            <Icons.Request size={16} color={colors.muted} strokeWidth={1.6} />
          </View>
        </View>
        <Txt style={[type.rlcMicro, { color: colors.accent }]}>They get</Txt>
        <Txt style={[type.rlcFigBg, { color: colors.accent, marginTop: 6 }]}>{inrRaw(getR)}</Txt>
        <Lock />
      </View>
    );
  }
  if (variant === 'C') {
    return (
      <View style={[s.card, s.padC]}>
        <Txt style={[type.rlcMicro, { color: colors.accent }]}>They get</Txt>
        <Txt style={[type.rlcFigC, { color: colors.accent, marginTop: 6, marginBottom: 2 }]}>{inrRaw(getR)}</Txt>
        <Txt style={s.eq}>= {usd(payUsd)} from your balance</Txt>
        <Lock center />
      </View>
    );
  }
  // A — two-column (default)
  return (
    <View style={[s.card, s.padA]}>
      <View style={s.cols}>
        <View>
          <Txt style={type.rlcMicro}>You pay</Txt>
          <Txt style={[type.rlcFigA, { color: colors.ink, marginTop: 7 }]}>{usd(payUsd)}</Txt>
        </View>
        <View style={s.swap}>
          <Icons.Swap size={16} color={colors.muted} strokeWidth={1.5} />
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt style={[type.rlcMicro, { color: colors.accent }]}>They get</Txt>
          <Txt style={[type.rlcFigA, { color: colors.accent, marginTop: 7 }]}>{inrRaw(getR)}</Txt>
        </View>
      </View>
      <Lock />
    </View>
  );
}

const s = {
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hair,
    borderRadius: radii.rlc,
    ...shadows.rlc,
  },
  padA: { paddingTop: 20, paddingLeft: 20, paddingRight: 20, paddingBottom: 16 },
  padB: { paddingTop: 18, paddingLeft: 20, paddingRight: 20, paddingBottom: 15 },
  padC: { paddingTop: 22, paddingLeft: 20, paddingRight: 20, paddingBottom: 16, alignItems: 'center' },
  cols: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  swap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.inkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: { alignItems: 'center', marginTop: 8, marginBottom: 8 },
  arrowChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.inkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eq: { ...type.leadInk, fontSize: 14.5, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.hair, marginTop: 16, marginBottom: 13 },
  lock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lockL: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  lockLabel: { ...type.inst, fontSize: 13.5 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.accent },
} satisfies Record<string, CSSProperties>;
