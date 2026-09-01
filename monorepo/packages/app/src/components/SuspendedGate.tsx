'use client';

// SuspendedGate — full-screen account-blocked state, mounted once in the root layout (mirrors
// ToastHost). Covers EVERY route: once the backend answers 403 account_suspended (or
// account_deleted) the api-layer hook flips the store flag and this paints over whatever screen
// the user was on — never a silent $0 balance. No balance, no activity, no sign-out (the session
// is fine; the account isn't). Clears itself when a later load()/refresh() succeeds after
// reinstatement. One gate, two states — deleted gets its own copy because the story differs:
// paused is temporary, deleted is final but the money was never ours to hold.
import type { CSSProperties } from 'react';

import { colors, fonts, Txt, View } from '@fpay/ui';
import { usePayStore } from '../store';

export function SuspendedGate() {
  const suspended = usePayStore((s) => s.suspended);
  const deleted = usePayStore((s) => s.deleted);
  if (!suspended && !deleted) return null;
  return (
    <View style={styles.wrap} role="alert">
      <Txt style={styles.title}>{deleted ? 'This account has been deleted' : 'Your account is paused'}</Txt>
      <Txt style={styles.body}>
        {deleted
          ? 'You no longer have access to the app. Your money is your own — it lives in your embedded ' +
            'wallet. A payment that was in flight is settled or refunded like any other; nothing else ' +
            'is held. Contact support if you need help reaching it.'
          : 'You can’t send or receive money right now. Contact support to sort it out — your money is ' +
            'safe and stays yours.'}
      </Txt>
    </View>
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
  title: { ...fonts.body600, fontSize: 22, lineHeight: '28px', color: colors.ink, textAlign: 'center' },
  body: {
    ...fonts.body500,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: '21px',
    color: colors.muted,
    maxWidth: 320,
  },
} satisfies Record<string, CSSProperties>;
