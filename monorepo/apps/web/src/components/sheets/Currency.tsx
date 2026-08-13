'use client';

// Currency.tsx — pick the display currency. The choice lives in the store (persisted) and drives
// the home balance + amount formatting.
//
// The list is derived, not written down: dollars (what the balance actually is) plus whatever the
// user's own country spends. It used to be a hardcoded INR/USD pair, which offered rupees to
// someone in Indonesia and never offered them rupiah.
import { currencyForCountry } from '@fpay/shared';

import { Icons } from '@/components/icons';
import { Grab, List, Row, RowMeta, SheetBody, SheetHeader } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import type { DisplayCurrency } from '@/lib/money';
import { fiatSymbol, isDisplayCurrency } from '@/lib/money';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

/** Intl ships everywhere we run and already knows every currency and country name; a hand-kept
 *  table of them would only be a second thing to update when a corridor lands. */
const displayName = (kind: 'currency' | 'region', code: string): string => {
  try {
    return new Intl.DisplayNames(['en'], { type: kind }).of(code) ?? code;
  } catch {
    return code;
  }
};

export function Currency() {
  const close = usePayStore((s) => s.close);
  const displayCurrency = usePayStore((s) => s.displayCurrency);
  const setDisplayCurrency = usePayStore((s) => s.setDisplayCurrency);
  const country = usePayStore((s) => s.country);

  const local = currencyForCountry(country);
  const options: Array<{ code: DisplayCurrency; name: string; sub: string }> = [
    { code: 'USD', name: displayName('currency', 'USD'), sub: '$ · your actual balance' },
  ];
  // Dropped when their country has no rail, when we can't price its currency, or when they are
  // already reading in dollars-and-nothing-else — in every case there is no second choice to offer.
  if (local && local !== 'USD' && isDisplayCurrency(local)) {
    options.push({
      code: local,
      name: displayName('currency', local),
      sub: `${fiatSymbol(local)} · what you spend in ${displayName('region', country)}`,
    });
  }

  return (
    <>
      <Grab />
      <SheetHeader title="Display currency" onClose={close} />
      <SheetBody>
        <Txt style={[type.lead, { marginBottom: 14 }]}>Choose how balances and amounts are shown.</Txt>
        <List>
          {options.map((o) => (
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
