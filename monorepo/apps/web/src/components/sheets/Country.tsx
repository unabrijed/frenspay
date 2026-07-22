'use client';

// Country.tsx — pick the dialing-default country (drives local-format phone lookups: type a
// number without +code and fpay assumes this country's code). Auto-set from locale/enrolled
// phone; this sheet is the manual override. Names via Intl.DisplayNames — zero deps.
import { useMemo, useState } from 'react';

import { ISO_TO_DIAL } from '@fpay/shared';

import { Icons } from '@/components/icons';
import { Grab, List, Row, RowMeta, SearchBar, SheetBody, SheetHeader } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

export function Country() {
  const close = usePayStore((s) => s.close);
  const country = usePayStore((s) => s.country);
  const setCountry = usePayStore((s) => s.setCountry);
  const [query, setQuery] = useState('');

  const all = useMemo(() => {
    let dn: Intl.DisplayNames | undefined;
    try {
      dn = new Intl.DisplayNames([navigator.language], { type: 'region' });
    } catch {
      /* fall back to ISO codes */
    }
    return Object.keys(ISO_TO_DIAL)
      .map((iso) => ({ iso, name: dn?.of(iso) ?? iso, dial: '+' + ISO_TO_DIAL[iso] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const q = query.trim().toLowerCase();
  const rows = q ? all.filter((c) => c.name.toLowerCase().includes(q) || c.dial.includes(q) || c.iso.toLowerCase() === q) : all;

  return (
    <>
      <Grab />
      <SheetHeader title="Country" onClose={close} />
      <SheetBody style={{ overflowY: 'auto' }}>
        <Txt style={[type.lead, { marginBottom: 12 }]}>
          Numbers without a +code are treated as local to this country.
        </Txt>
        <SearchBar placeholder="Search countries" value={query} onChangeText={setQuery} />
        <List>
          {rows.map((c) => (
            <Row
              key={c.iso}
              onPress={() => {
                void setCountry(c.iso);
                close();
              }}>
              <RowMeta>
                <Txt style={type.rowName}>{c.name}</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>{c.dial}</Txt>
              </RowMeta>
              {country === c.iso ? <Icons.Check size={18} color={colors.accent} /> : null}
            </Row>
          ))}
        </List>
      </SheetBody>
    </>
  );
}
