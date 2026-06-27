'use client';

// useLiveSync — keeps the signed-in user's balance + activity current so incoming money shows up
// without a manual refresh (the receiver side of a P2P send). Polls store.refresh() on an interval
// while the tab is visible, and refreshes immediately on focus / when the tab returns to foreground.
// Pauses when hidden to avoid wasted calls. The backend confirmer flips pending→confirmed.
import { useEffect } from 'react';

import { usePayStore } from '@/store/usePayStore';

const INTERVAL_MS = 12_000;

export function useLiveSync(): void {
  const signedIn = usePayStore((s) => s.authStatus === 'signedIn');

  useEffect(() => {
    if (!signedIn) return;

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
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };
  }, [signedIn]);
}

/** Null component so the hook can be mounted once at the app root. */
export function LiveSync(): null {
  useLiveSync();
  return null;
}
