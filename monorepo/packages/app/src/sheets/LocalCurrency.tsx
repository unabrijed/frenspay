'use client';

// LocalCurrency.tsx — pin the balance's second line, or let it follow the profile country.
// Sibling of Currency.tsx (which picks the PREFERRED currency). Unlike that picker, this one
// deliberately offers EVERY display currency, not just the country's own: the pin exists exactly
// to override the country derivation (an expat in Indonesia who thinks in rupees). 'Automatic'
// (null server-side) returns to the derived behavior.
import { currencyForCountry, DISPLAY_CURRENCIES, fiatSymbol } from '@fpay/shared';

import { colors, Grab, Icons, List, Row, RowMeta, SheetBody, SheetHeader, Txt, type } from '@fpay/ui';
import { usePayStore } from '../store';

const displayName = (kind: 'currency' | 'region', code: string): string => {
  try {
    return new Intl.DisplayNames(['en'], { type: kind }).of(code) ?? code;
  } catch {
    return code;
  }
};

export function LocalCurrency() {
  const close = usePayStore((s) => s.close);
  const localCurrency = usePayStore((s) => s.localCurrency);
  const setLocalCurrency = usePayStore((s) => s.setLocalCurrency);
  const country = usePayStore((s) => s.country);
  const derived = currencyForCountry(country);

  const options: Array<{ code: string | null; name: string; sub: string }> = [
    {
      code: null,
      name: 'Automatic',
      sub: derived ? `${displayName('currency', derived)}, from your country` : 'Follows your country',
    },
    ...DISPLAY_CURRENCIES.map((code) => ({
      code: code as string,
      name: displayName('currency', code),
      sub: fiatSymbol(code),
    })),
  ];

  return (
    <>
      <Grab />
      <SheetHeader title="Local currency" onClose={close} />
      <SheetBody>
        <Txt style={[type.lead, { marginBottom: 14 }]}>
          The second line under your balance. Pin one, or let it follow your country.
        </Txt>
        <List>
          {options.map((o) => (
            <Row
              key={o.code ?? 'auto'}
              onPress={() => {
                void setLocalCurrency(o.code);
                close();
              }}>
              <RowMeta>
                <Txt style={type.rowName}>{o.name}</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>{o.sub}</Txt>
              </RowMeta>
              {localCurrency === o.code ? <Icons.Check size={18} color={colors.accent} /> : null}
            </Row>
          ))}
        </List>
      </SheetBody>
    </>
  );
}
