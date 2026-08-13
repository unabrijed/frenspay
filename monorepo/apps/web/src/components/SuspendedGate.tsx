'use client';

// SuspendedGate — full-screen "account paused" state, mounted once in the root layout (mirrors
// ToastHost). Covers EVERY route: once the backend answers 403 account_suspended the api-layer
// hook flips store.suspended and this paints over whatever screen the user was on — never a
// silent $0 balance. No balance, no activity, no sign-out (the session is fine; the account
// isn't). Clears itself when a later load()/refresh() succeeds after reinstatement.
import type { CSSProperties } from 'react';

import { Txt } from '@/components/ui/Txt';
import { colors } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

export function SuspendedGate() {
  const suspended = usePayStore((s) => s.suspended);
  if (!suspended) return null;
  return (
    <div style={styles.wrap} role="alert">
      <Txt style={styles.title}>Your account is paused</Txt>
      <Txt style={styles.body}>
        You can’t send or receive money right now. Contact support to sort it out — your money is
        safe and stays yours.
      </Txt>
    </div>
  );
}

const styles = {
  wrap: {
    position: 'fixed',
    inset: 0,
    zIndex: 80, // above ToastHost (60) and SheetHost (50) — nothing beneath is usable anyway
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
    textAlign: 'center',
    backgroundColor: colors.canvas,
  },
  title: { fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 22, lineHeight: '28px', color: colors.ink },
  body: {
    fontFamily: 'var(--font-sans)',
    fontWeight: 500,
    fontSize: 14,
    lineHeight: '21px',
    color: colors.muted,
    maxWidth: 320,
  },
} satisfies Record<string, CSSProperties>;
