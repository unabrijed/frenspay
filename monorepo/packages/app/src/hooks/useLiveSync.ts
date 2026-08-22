'use client';

// useLiveSync — keeps the signed-in user's balance + activity current so incoming money shows up
// without a manual refresh (the receiver side of a P2P send). Polls store.refresh() on an interval
// while the tab is visible, and refreshes immediately on focus / when the tab returns to foreground.
// Pauses when hidden to avoid wasted calls. The backend confirmer flips pending→confirmed.
import { useEffect } from 'react';

import { platform } from '../platform';
import { usePayStore } from '../store';

const INTERVAL_MS = 12_000;

export function useLiveSync(): void {
  // Only poll once the backend user exists (synced this session, or a returning onboarded user).
  // Gating on raw signedIn would start the poller mid-onboarding, before /auth/sync, and 401.
  const ready = usePayStore((s) => s.authStatus === 'signedIn' && (s.provisioned || s.onboarded));

  useEffect(() => {
    if (!ready) return;

    const refresh = () => void usePayStore.getState().refresh();
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      refresh(); // catch up immediately
      timer = setInterval(refresh, INTERVAL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    start();
    // Web: visibilitychange (not focus — focus ALSO fires for same-tab refocus, each a duplicate of a
    // poll already running). Native: AppState active/background.
    const off = platform().onForeground((fg) => (fg ? start() : stop()));
    return () => {
      stop();
      off();
    };
  }, [ready]);
}

/** Null component so the hook can be mounted once at the app root. */
export function LiveSync(): null {
  useLiveSync();
  return null;
}
