'use client';

// SheetHost — store-driven bottom-sheet layer (web port). One overlay renders whichever
// sheet `store.sheet` names over a tap-to-dismiss scrim, with a rise+fade entrance/exit
// done with CSS transitions (no RN Animated). Mounted once in the root layout.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { AddMoney } from '@/components/sheets/AddMoney';
import { Currency } from '@/components/sheets/Currency';
import { Help } from '@/components/sheets/Help';
import { Request, RequestPick, RequestSent, Send, SendAmount, SendFailed, Sent } from '@/components/sheets/friends';
import { Recovery, Verify } from '@/components/sheets/identity';
import { Notifications } from '@/components/sheets/notifications';
import { OrderTracking } from '@/components/sheets/OrderTracking';
import { Amount, Scan } from '@/components/sheets/pay';
import { QuoteSheet } from '@/components/sheets/Quote';
import { Receive } from '@/components/sheets/Receive';
import { colors, radii, shadows } from '@/lib/theme';
import { type SheetId, usePayStore } from '@/store/usePayStore';

const TALL = new Set<SheetId>([
  'scan',
  'amount',
  'send',
  'sendAmount',
  'request',
  'requestPick',
  'requestSent',
  'sent',
  'verify',
  'recovery',
  'quote',
  'tracking',
  'notifications',
]);

function renderSheet(id: SheetId) {
  switch (id) {
    case 'scan':
      return <Scan />;
    case 'amount':
      return <Amount />;
    case 'add':
      return <AddMoney />;
    case 'send':
      return <Send />;
    case 'sendAmount':
      return <SendAmount />;
    case 'request':
      return <Request />;
    case 'requestPick':
      return <RequestPick />;
    case 'requestSent':
      return <RequestSent />;
    case 'sent':
      return <Sent />;
    case 'sendFailed':
      return <SendFailed />;
    case 'verify':
      return <Verify />;
    case 'recovery':
      return <Recovery />;
    case 'receive':
      return <Receive />;
    case 'currency':
      return <Currency />;
    case 'quote':
      return <QuoteSheet />;
    case 'tracking':
      return <OrderTracking />;
    case 'help':
      return <Help />;
    case 'notifications':
      return <Notifications />;
    default:
      return null;
  }
}

export function SheetHost() {
  const sheet = usePayStore((s) => s.sheet);
  const closing = usePayStore((s) => s.closing);
  const close = usePayStore((s) => s.close);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (sheet && !closing) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    return undefined;
  }, [sheet, closing]);

  if (!sheet) return null;
  const tall = TALL.has(sheet);

  return (
    <div style={styles.overlay}>
      <div
        onClick={close}
        style={{ ...styles.scrim, opacity: shown ? 1 : 0 }}
      />
      <div
        style={{
          ...styles.sheet,
          ...(tall ? { top: 'calc(env(safe-area-inset-top) + 10px)' } : { maxHeight: '92%' }),
          opacity: shown ? 1 : 0.4,
          transform: shown ? 'translateY(0)' : 'translateY(16px)',
        }}
      >
        {renderSheet(sheet)}
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'absolute', inset: 0, zIndex: 50 },
  scrim: {
    position: 'absolute',
    inset: 0,
    background: colors.scrim,
    transition: 'opacity 280ms ease',
    cursor: 'pointer',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    paddingBottom: 'env(safe-area-inset-bottom)',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    boxShadow: shadows.sheet,
    transition: 'opacity 280ms ease, transform 280ms ease',
  },
} satisfies Record<string, CSSProperties>;
