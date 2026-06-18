// RateLock — the signature element. Three approved variants; default Columns (A).
// Appears on Review, Success, and Transaction detail. Ported from screens-core.jsx.
import { StyleSheet, View } from 'react-native';

import { Icons } from '@/components/icons';
import { Txt } from '@/components/ui/Txt';
import { inrRaw, usd } from '@/lib/money';
import { colors, radii, shadows, type } from '@/lib/theme';
import { RATE_LABEL } from '@/services/wallet';

export type RlcVariant = 'A' | 'B' | 'C';

function Lock({ center }: { center?: boolean }) {
  return (
    <>
      <View style={s.divider} />
      <View style={[s.lock, center && { justifyContent: 'center', gap: 12 }]}>
        <View style={s.lockL}>
          <View style={s.dot} />
          <Txt style={s.lockLabel}>Rate locked</Txt>
        </View>
        <Txt style={type.rateLine}>{RATE_LABEL}</Txt>
      </View>
    </>
  );
}

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
        <Txt style={[type.rlcMicro, { color: colors.accent }]}>Merchant gets</Txt>
        <Txt style={[type.rlcFigBg, { color: colors.accent, marginTop: 6 }]}>{inrRaw(getR)}</Txt>
        <Lock />
      </View>
    );
  }
  if (variant === 'C') {
    return (
      <View style={[s.card, s.padC]}>
        <Txt style={[type.rlcMicro, { color: colors.accent }]}>Merchant gets</Txt>
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
          <Txt style={[type.rlcMicro, { color: colors.accent }]}>Merchant gets</Txt>
          <Txt style={[type.rlcFigA, { color: colors.accent, marginTop: 7 }]}>{inrRaw(getR)}</Txt>
        </View>
      </View>
      <Lock />
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hair,
    borderRadius: radii.rlc,
    ...shadows.rlc,
  },
  padA: { paddingTop: 20, paddingHorizontal: 20, paddingBottom: 16 },
  padB: { paddingTop: 18, paddingHorizontal: 20, paddingBottom: 15 },
  padC: { paddingTop: 22, paddingHorizontal: 20, paddingBottom: 16, alignItems: 'center' },
  cols: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  swap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.inkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: { alignItems: 'center', marginVertical: 8 },
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
});
