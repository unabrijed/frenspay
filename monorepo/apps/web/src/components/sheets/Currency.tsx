'use client';

// Currency.tsx — pick the display currency. The choice lives in the store (persisted) and drives
// the home hero toggle + amount formatting. Phase 1 supports INR/USD only (one fixed FX rate).
import type { CSSProperties } from 'react';

import { Icons } from '@/components/icons';
import { Grab, List, Row, RowMeta, SheetBody, SheetHeader } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import type { DisplayCurrency } from '@/lib/money';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

const OPTIONS: Array<{ code: DisplayCurrency; name: string; sub: string }> = [
  { code: 'INR', name: 'Indian Rupee', sub: '₹ · what you spend in India' },
  { code: 'USD', name: 'US Dollar', sub: '$ · your actual balance' },
];

export function Currency() {
  const close = usePayStore((s) => s.close);
  const displayCurrency = usePayStore((s) => s.displayCurrency);
  const setDisplayCurrency = usePayStore((s) => s.setDisplayCurrency);
  return (
    <>
      <Grab />
      <SheetHeader title="Display currency" onClose={close} />
      <SheetBody>
        <Txt style={[type.lead, { marginBottom: 14 }]}>Choose how balances and amounts are shown.</Txt>
        <List>
          {OPTIONS.map((o) => (
            <Row
              key={o.code}
              onPress={() => {
                setDisplayCurrency(o.code);
                close();
              }}>
              <RowMeta>
                <Txt style={type.rowName}>{o.name}</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>{o.sub}</Txt>
              </RowMeta>
              {displayCurrency === o.code ? <Icons.Check size={18} color={colors.accent} /> : null}
            </Row>
          ))}
        </List>
      </SheetBody>
    </>
  );
}
