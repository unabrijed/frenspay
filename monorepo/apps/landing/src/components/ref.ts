// ref.ts — who referred this visitor, and making that survive the URL.
//
// The link is only the DELIVERY vehicle; localStorage is the attribution. A visitor who arrives on
// /?ref=@asha, strips the query, and comes back a week later to a bare URL is still credited to
// @asha — otherwise attribution is trivially shed, and referral rewards mean nothing.
//
// **Last touch wins**: every new link overwrites the stored value (Bridge, 2026-08-01). The backend
// agrees — `waitlist.referred_by` uses `coalesce(excluded, waitlist)` so a submit carrying a ref
// replaces the previous referrer. Mirrors apps/web/src/app/page.tsx, which already does exactly this
// for the app's own invite gate, down to the key name and the no-expiry behaviour.
//
// Pure functions, no React: capture runs once from an effect, read runs at submit time.

const KEY = 'fpay:ref';

// Mirrors the server's REF_RE (apps/backend/src/routes/waitlist.ts). Matches both shapes a ref can
// take: '@asha' (an app user's handle) and 'k3n8q2wp' (an f-list member's code). Validating BEFORE
// storing keeps junk out of the database and out of the "invited you" line.
const REF_RE = /^@?[a-z0-9_]{1,20}$/;

function fromUrl(): string | null {
  const raw = new URLSearchParams(window.location.search).get('ref')?.trim().toLowerCase();
  return raw && REF_RE.test(raw) ? raw : null;
}

/** Persist the ref from the current URL, overwriting any previous one. Call once on mount. */
export function captureRef(): void {
  const ref = fromUrl();
  if (!ref) return;
  try {
    localStorage.setItem(KEY, ref);
  } catch {
    /* storage blocked — readRef still falls back to the URL for this visit */
  }
}

/** The ref to credit. URL first so a fresh click always beats the cache, then the stored value. */
export function readRef(): string | null {
  const url = fromUrl();
  if (url) return url;
  try {
    const stored = localStorage.getItem(KEY);
    return stored && REF_RE.test(stored) ? stored : null;
  } catch {
    return null; /* storage blocked */
  }
}

// isHandle() lived here to decide which refs were safe to forward to the app's invite gate. That
// gate now takes real invite codes (lib/invite.ts), which are never handles, so nothing forwards a
// ref any more and the helper had no callers. `?ref=` is purely f-list attribution now.
