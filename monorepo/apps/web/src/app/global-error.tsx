'use client';

// global-error — root-level catch for render/chunk errors during the client-only boot. Must be
// fully self-contained (renders its own <html><body>, inline styles, a hand-inlined mark) — it
// replaces the whole tree, so app providers/components are unavailable here: importing <Mark> from
// primitives would pull in the very chunk graph that just failed to load. On a chunk-load error it
// self-heals with a cache-BUSTING navigation (a plain reload won't fix a stale cache), guarded so
// it reloads at most once / 10s.
import { useEffect } from 'react';

// Brand literals (mirror globals.css): --canvas / --ink / --muted / --accent.
const CANVAS = '#fce8cb';
const INK = '#2b3131';
const MUTED = '#6b6156';
const ACCENT = '#b94f2b';

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const msg = `${error?.name ?? ''} ${error?.message ?? ''}`;
    const isChunkError =
      /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
        msg,
      );
    if (isChunkError && typeof window !== 'undefined') {
      const KEY = 'fpay:chunk-reload-at';
      const last = Number(window.sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 10_000) {
        window.sessionStorage.setItem(KEY, String(Date.now()));
        const u = new URL(window.location.href);
        u.searchParams.set('_r', String(Date.now())); // cache-bust: forces a fresh document
        window.location.replace(u.toString());
      }
    }
  }, [error]);

  // A hard, cache-busting navigation is the recovery for chunk/boot failures — reset() can't refetch
  // a missing chunk, so we don't bother with it here.
  const reload = () => {
    const u = new URL(window.location.href);
    u.searchParams.set('_r', String(Date.now()));
    window.location.replace(u.toString());
  };

  return (
    <html lang="en">
      <body style={{ margin: 0, background: CANVAS, color: INK, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 24,
            textAlign: 'center',
          }}
        >
          {/* The mark, static — geometry copied from brand/logo-icon.svg, same as
              components/ui/primitives.tsx. No bead and no animation: this page has no
              stylesheet, and a failure screen is not the place for the pair to hop. */}
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: ACCENT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width={38} height={38} viewBox="0 0 256 256" fill="none" aria-hidden="true">
              <path
                d="M60 136 C82 132 98 184 128 192 C158 184 174 132 196 136"
                stroke={CANVAS}
                strokeWidth="48"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="66" cy="74" r="31" fill={CANVAS} />
              <circle cx="190" cy="74" r="31" fill={CANVAS} />
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ margin: 0, maxWidth: 280, color: MUTED }}>The app failed to load. Reload to try again.</p>
          <button
            onClick={reload}
            style={{
              marginTop: 8,
              background: ACCENT,
              color: '#fff',
              border: 'none',
              borderRadius: 14,
              padding: '14px 28px',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
