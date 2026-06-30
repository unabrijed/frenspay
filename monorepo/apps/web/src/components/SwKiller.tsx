'use client';

// SwKiller — this app ships NO service worker. localhost:3000 is a shared dev origin, so an SW
// registered by another project persists here and intercepts requests, serving stale/blank
// responses that only a hard refresh bypasses. Unregister any SW + clear its caches on boot, then
// reload once so the page loads uncontrolled. No-op when none exists. (Remove if a PWA/SW is added.)
import { useEffect } from 'react';

export function SwKiller(): null {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        if (regs.length === 0) return;
        Promise.all(regs.map((r) => r.unregister()))
          .then(() => (typeof caches !== 'undefined' ? caches.keys() : Promise.resolve([])))
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .then(() => {
            // Reload once so the page loads uncontrolled (the SW still controls THIS document until a
            // navigation). Guard against a loop via sessionStorage — but if it's unavailable (Safari
            // private mode) still reload: the next load finds 0 registrations and stops, so no loop.
            const KEY = 'tabroad:sw-killed';
            let alreadyKilled = false;
            try {
              alreadyKilled = sessionStorage.getItem(KEY) === '1';
              if (!alreadyKilled) sessionStorage.setItem(KEY, '1');
            } catch {
              /* sessionStorage blocked — fall through and reload anyway */
            }
            if (!alreadyKilled) window.location.reload();
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);
  return null;
}
