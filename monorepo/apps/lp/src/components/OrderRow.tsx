'use client';

// OrderRow — one order in a list, on Home (the queues) and on Activity (what settled). Shared so the
// two screens say the same word for the same state.
import type { CSSProperties } from 'react';

import type { MerchantOrder } from '@fpay/shared';
import { fiatRaw } from '@fpay/shared';

import { Icons } from '@fpay/ui/icons';
import { Row, RowMeta } from '@fpay/ui/primitives';
import { View } from '@fpay/ui/rn';
import { Txt } from '@fpay/ui/Txt';
import { colors, fonts, type } from '@fpay/ui/theme';

const clamp1: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/** Orders still needing the partner to act, or still inside their release window. */
export const isLive = (o: MerchantOrder) => o.state === 'payment_detected';
/** Work this partner has committed to: theirs, funded, and actually taken. */
export const isHeld = (o: MerchantOrder) => o.mine && isLive(o) && o.lockedAt != null;
/** Up for grabs — either routed to them and not yet taken, or someone else's that has gone open. */
export const isTakeable = (o: MerchantOrder) => isLive(o) && o.lockedAt == null && o.payoutClaimedAt == null;
/** Theirs and past the live phase: releasing or settled. What Activity lists. */
export const isDone = (o: MerchantOrder) => o.mine && !isLive(o);

export function statusText(o: MerchantOrder): string {
  if (o.state === 'completed') return 'Settled';
  if (o.state === 'merchant_confirms' || o.state === 'funds_released') return 'Releasing';
  if (o.resolution === 'under_review') return 'Disputed';
  if (o.payoutClaimedAt != null) return 'Releasing';
  // Untaken. "Take it" for anything still up for grabs; the routed partner sees the same word during
  // their head start, which is honest — holding it first isn't holding it.
  return o.lockedAt == null ? 'Take it' : 'Pay now';
}
function statusColor(o: MerchantOrder): string {
  if (o.resolution === 'under_review') return colors.danger;
  if (o.state === 'completed') return colors.secondary;
  return o.payoutClaimedAt ? colors.muted : colors.accent;
}

export function OrderRow({ o, onPress }: { o: MerchantOrder; onPress: () => void }) {
  return (
    <Row onPress={onPress}>
      <RowMeta>
        <Txt style={[type.rowName, clamp1]}>{fiatRaw(o.amountInr, o.currency)}</Txt>
        <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>
          {/* payoutDestination is absent on anything this partner hasn't taken — the server redacts
              it, so this falls through to the reference rather than leaking a payee. */}
          {o.payoutDestination ?? o.payoutName ?? o.referenceCode}
        </Txt>
      </RowMeta>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Txt style={{ ...fonts.body500, fontSize: 14, color: statusColor(o) }}>{statusText(o)}</Txt>
        <Icons.Chevron size={16} color={colors.muted} />
      </View>
    </Row>
  );
}
