'use client';

// TxCard — fpay transaction row as an individual tactile card (Home recent + Activity history).
// Circular type icon · title · time/Settling-Settled status on the left; signed USD (+ optional ≈₹) right.
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { Icons } from '@/components/icons';
import { MaskedAmount } from '@/components/ui/MaskedAmount';
import { Pressable, View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { inr, usd } from '@/lib/money';
import { colors, radii, shadows, type } from '@/lib/theme';
import type { Txn } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

const clamp1: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

export function TxCard({ tx, onPress, showInr = false }: { tx: Txn; onPress?: () => void; showInr?: boolean }) {
  // The live mid rate, not the 87.55 fallback — this row sits next to the real balance.
  const fxRate = usePayStore((s) => s.fxRate);
  const hideAmounts = usePayStore((s) => s.hideAmounts);
  // One tap reveals BOTH amount lines of this row (they're the same money) — controlled reveal,
  // local so it clears when the row unmounts on navigation.
  const [revealed, setRevealed] = useState(false);
  const merchant = tx.type === 'pay';
  const positive = tx.type === 'add';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed ? { backgroundColor: colors.surfaceLow } : null]}>
      <View style={styles.left}>
        <View style={styles.icon}>
          {merchant ? (
            <Icons.Qr size={20} color={colors.secondary} />
          ) : positive ? (
            <Icons.Plus size={20} color={colors.secondary} />
          ) : (
            <Icons.Send size={20} color={colors.secondary} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={[type.rowName, clamp1]}>{tx.title}</Txt>
          <Txt style={[type.rowTime, { marginTop: 2 }]}>
            {tx.time}
            {tx.status === 'pending' && <Txt style={{ color: colors.accent }}> · Processing…</Txt>}
            {tx.status === 'confirmed' && <Txt style={{ color: colors.secondary }}> · Completed</Txt>}
            {tx.status === 'failed' && <Txt style={{ color: colors.danger }}> · Failed</Txt>}
          </Txt>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <MaskedAmount
          value={`${positive ? '+' : '−'}${usd(Math.abs(tx.usd))}`}
          style={[type.rowAmount, positive ? { color: colors.secondary } : null]}
          revealed={revealed}
          onToggle={() => setRevealed((v) => !v)}
        />
        {showInr && (!hideAmounts || revealed) ? (
          <Txt style={[type.rowTime, { marginTop: 2 }]}>{inr(Math.abs(tx.usd), fxRate)}</Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

const cardBase: CSSProperties = {
  backgroundColor: colors.surface,
  borderRadius: radii.field,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: colors.outlineVariant,
  boxShadow: shadows.card,
};

const styles = {
  card: { ...cardBase, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  icon: { width: 46, height: 46, borderRadius: 999, backgroundColor: colors.surfaceContainer, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
} satisfies Record<string, CSSProperties>;
