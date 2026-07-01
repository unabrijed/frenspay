// boot.ts — boot instrumentation + the splash watchdog.
//
// The web app's first COLD load can stall on a gate — Privy `ready`, store hydration, or the Privy
// chunk download — and a warm reload then "fixes" it (the reported "doesn't load until I refresh").
// These helpers (a) log each gate's elapsed time in dev so the real stall is MEASURED, not guessed,
// and (b) back a last-resort auto-reload if a Splash stays on screen past a ceiling.

const start = typeof performance !== 'undefined' ? performance.now() : 0;

/** Dev-only: log a boot milestone with ms since first module eval. No-op in production. */
export function bootTrace(label: string): void {
  if (process.env.NODE_ENV === 'production') return;
  if (typeof console === 'undefined') return;
  const ms = typeof performance !== 'undefined' ? Math.round(performance.now() - start) : 0;
  // eslint-disable-next-line no-console
  console.info(`[boot] ${label} +${ms}ms`);
}

/** How long a Splash may stay mounted before the watchdog force-reloads (last resort). */
export const SPLASH_WATCHDOG_MS = 8000;

/**
 * One guarded, cache-busting reload — the same recovery global-error.tsx uses for chunk failures.
 * Reloads at most once per 10s (sessionStorage) so it can never loop. Returns true if it reloaded.
 */
export function bootRecoverReload(reason: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const KEY = 'fpay:boot-reload-at';
    const last = Number(window.sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10_000) return false;
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* sessionStorage blocked (Safari private) — proceed; a re-arm is harmless and still guarded by time */
  }
  bootTrace(`watchdog reload (${reason})`);
  const u = new URL(window.location.href);
  u.searchParams.set('_r', String(Date.now())); // cache-bust: force a fresh document
  window.location.replace(u.toString());
  return true;
}
