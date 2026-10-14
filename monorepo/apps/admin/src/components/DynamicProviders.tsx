'use client';

// Providers.tsx — minimal Dynamic for the console: login + access token, NOTHING else. No embedded
// wallets, no smart wallets, no signers — admin never moves money client-side.
//
// The gate asks BOTH questions. Dynamic answers "who are you"; GET /me answers "are you an operator",
// and the console mounts for nobody else. It used to render for anyone who could log in: every
// panel still 403'd, so no data escaped, but a stranger got the shell and the nav — which is a map
// of the operation. The server remains the authority (requireAdmin); this is a gate over it, never
// a replacement for it.
//
// Without Dynamic configured (local dev), requests fall back to the x-dev-user-id shim in api.ts,
// so children render directly.
//
// ONE Dynamic app for both targets (envConfig.DYNAMIC_ENVIRONMENT_ID), so the session survives the env switch
// and the provider never has to swap app ids under a live tree.
import { DynamicContextProvider, useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { getDefaultClient, refreshAuth } from '@dynamic-labs-sdk/client';
import { useEffect, useState, type ReactNode } from 'react';

import { EnvSwitch } from '@/components/EnvSwitch';
import { Denied } from '@/components/ui';
import { api, ApiError, setAuthToken, setTokenRefresher } from '@/services/api';
import { apiHost } from '@/services/apiMode';
import { isProduction, DYNAMIC_ENVIRONMENT_ID } from '@/services/envConfig';

/** What /me said about this account.
 *  'absent'   = the token verified, and this backend has no row for it.
 *  'refused'  = the token did not verify AT ALL, so no row was ever looked up — an expired session,
 *               or a backend configured with a different Dynamic app than this console signs into. */
type Access = 'checking' | 'admin' | 'denied' | 'absent' | 'refused' | 'error';

// Safety net, same one apps/web/src/services/dynamic/DynamicRoot.tsx keeps and for the same reason: if
// the SDK never initialises (blocked network, or this origin missing from the Dynamic app's allowed
// origins) `ready` stays false forever and the splash below never lifts. Falling through renders the
// Sign in screen, which carries the env switch — a wrong target stops being a dead end.
const PRIVY_READY_TIMEOUT_MS = 4000;

function AuthGate({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, getAccessToken } = useSession();
  // Children only mount once a token is actually in the api client — otherwise the first page
  // fetch races the token effect and burns a 401 round-trip on every load.
  const [tokenReady, setTokenReady] = useState(false);
  const [access, setAccess] = useState<Access>('checking');
  const [readyTimedOut, setReadyTimedOut] = useState(false);

  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setReadyTimedOut(true), PRIVY_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    if (!authenticated) {
      setAuthToken(null);
      setTokenRefresher(null);
      setTokenReady(false);
      setAccess('checking');
      return;
    }
    setTokenRefresher(getAccessToken);
    // .finally, not .then — a REJECTED token has to advance the gate too. Without it the rejection
    // died unhandled, tokenReady never flipped, and the console sat on "Signing in…" forever with no
    // control on screen. Letting it through sends a tokenless /me, which 401s into NoAccess — a
    // screen that at least has Sign out and the env switch on it.
    void getAccessToken()
      .then((t) => setAuthToken(t))
      .catch(() => setAuthToken(null))
      .finally(() => setTokenReady(true));
  }, [authenticated, getAccessToken]);

  // The authorization half. `role` here is the EFFECTIVE role (backend auth.ts effectiveRole), so a
  // root admin named in ADMIN_EMAILS passes even though their users.role still reads 'user'.
  useEffect(() => {
    if (!tokenReady) return;
    let live = true;
    void api
      .me()
      .then((me) => live && setAccess(me.role === 'admin' ? 'admin' : 'denied'))
      // Signed in, but not usable here — and WHICH of the two is the whole diagnosis, so don't
      // collapse them. requireUserId raises 'no_account' when the token verified and this database
      // has no row (the console cannot create one; it never calls /auth/sync), and a bare
      // 'unauthorized' when the token itself was refused — which on a console that drives two
      // backends means the session belongs to the other one's Dynamic app. Reading both off `code`
      // needs api.ts's `message` handling; without it Fastify's generic "Unauthorized" made these
      // indistinguishable, and every rejected token was reported as a missing profile.
      .catch((e) => {
        if (!live) return;
        if (!(e instanceof ApiError)) return setAccess('error');
        if (e.code === 'no_account' || e.status === 404) return setAccess('absent');
        if (e.status === 401) return setAccess('refused');
        setAccess('error');
      });
    return () => {
      live = false;
    };
  }, [tokenReady]);

  if (!ready && !readyTimedOut) {
    return <div className="flex min-h-screen items-center justify-center text-[13px] text-muted">Loading…</div>;
  }
  if (!authenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-[22px] font-bold tracking-tight">
          fpay <span className="text-accent">admin</span>
        </p>
        <button
          type="button"
          onClick={login}
          className="rounded-md bg-accent px-5 py-2 text-[14px] font-semibold text-white hover:bg-accent-deep"
        >
          Sign in
        </button>
        {/* WHICH backend you are about to sign into, before you sign in. One login now works against
            either, so this only decides whose data you land in — which is the more dangerous half. */}
        <Target />
      </div>
    );
  }
  if (!tokenReady || access === 'checking') {
    // Target here too: /me has no timeout, so a backend that never answers parks on this screen, and
    // a screen you cannot leave is how the wrong target became a devtools problem.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 text-[13px] text-muted">
        Signing in…
        <Target />
      </div>
    );
  }
  if (access !== 'admin') {
    return <NoAccess kind={access} />;
  }
  return <>{children}</>;
}

/** Which backend this console is currently driving, plus the control to change it. Rendered on every
 *  pre-gate screen: each failure below is ABOUT an environment, and for most of this console's life
 *  none of them named one — "no profile on this environment" with no way to see or change which
 *  environment that was, and the switch itself stranded in Nav, behind the gate. */
function Target() {
  return (
    <div className="mt-2 flex flex-col items-center gap-2">
      <p className="text-[12px] text-muted">
        Backend: <span className="font-semibold">{apiHost()}</span>
      </p>
      <EnvSwitch />
    </div>
  );
}

/** The four ways in that aren't. Each says what to do next and offers a way to swap accounts —
 *  a dead end with no sign-out means clearing site data to try another address. */
function NoAccess({ kind }: { kind: Exclude<Access, 'checking' | 'admin'> }) {
  const { logout, user } = useSession();
  // Heading included, because only one of these four IS an authorization decision and the other
  // three spent a long time claiming to be one.
  const { title, copy } = {
    // undefined → Denied's own wording, the same sentence the ten pages show on a 403.
    denied: { title: undefined, copy: undefined },
    absent: {
      title: 'No profile here',
      copy: 'This account has no profile on this environment yet. Sign into the fpay app once with this address, then come back.',
    },
    // The token was refused outright, so nothing was ever looked up — say that, because the fix is
    // the session and not the account, and the two used to print the same sentence.
    refused: {
      title: 'Session refused',
      copy: 'This backend could not verify your session. Sign out and back in. If it repeats, check the backend authentication logs and confirm that the console and backend use the same Dynamic environment.',
    },
    error: {
      title: 'Backend unreachable',
      copy: 'Could not verify this account against the API. Check that the console is pointed at a reachable backend, then retry.',
    },
  }[kind];
  return (
    <Denied msg={copy} title={title}>
      {user?.email?.address ? <p className="mt-3 text-[12px] text-muted">Signed in as {user.email.address}</p> : null}
      <Target />
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-4 rounded-md border border-outline px-4 py-1.5 text-[13px] font-semibold text-muted hover:bg-surface-low"
      >
        Sign out
      </button>
    </Denied>
  );
}

/** Sidebar sign-out. Only meaningful under Dynamic; hidden in dev-shim mode — SignOutInner calls
 *  useSession(), which throws when no provider is above it, and the shim path renders children with no
 *  provider at all. The condition has to be the SAME one Providers used to decide that. */
export function SignOut() {
  if (!DYNAMIC_ENVIRONMENT_ID) return null;
  return <SignOutInner />;
}

function SignOutInner() {
  const { logout, user } = useSession();
  return (
    <div className="mt-auto border-t border-hair pt-3">
      <p className="truncate px-1 text-[11px] text-muted">{user?.email?.address ?? ''}</p>
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-1 w-full rounded-md border border-outline px-2 py-1 text-left text-[12px] font-semibold text-muted hover:bg-surface-low"
      >
        Sign out
      </button>
    </div>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // The app id is a build constant now, not a per-target lookup, so there is nothing to wait for
  // before mounting Dynamic: the provider renders identically on the server and the first client pass.
  // It used to read the mode out of localStorage in an effect and hold a "Loading…" screen until it
  // landed — one more screen with no control on it, for a value that no longer varies.
  //
  // No Dynamic app configured. In dev that is the intended x-dev-user-id shim path and children render
  // directly, exactly as before. In a BUILT bundle it is a missing variable, and this app's stated
  // rule is that such a misconfiguration must never be silent (envConfig.ts) — silence here means
  // the console renders, sends no credential, and 401s on every panel, which reads as a broken
  // backend.
  if (!DYNAMIC_ENVIRONMENT_ID) {
    if (!isProduction) return <>{children}</>;
    return (
      <Denied
        title="Not configured"
        msg="No Dynamic app is configured, so this console cannot sign anyone in. Set NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID and redeploy. NEXT_PUBLIC_* is inlined at build time."
      >
        <Target />
      </Denied>
    );
  }
  return <DynamicContextProvider settings={{environmentId:DYNAMIC_ENVIRONMENT_ID, appName:'Frenspay Admin'}}>
    <AuthGate>{children}</AuthGate>
  </DynamicContextProvider>;
}

let refreshing: Promise<void> | null = null;
const getAccessToken = async (force = false): Promise<string | null> => {
  if (force && !refreshing) {
    refreshing = refreshAuth().then(() => {}).finally(() => { refreshing = null; });
  }
  if (refreshing) await refreshing;
  return getDefaultClient().token;
};
function useSession() {
  const {sdkHasLoaded, user, setShowAuthFlow, handleLogOut} = useDynamicContext();
  return {ready:sdkHasLoaded, authenticated:Boolean(user), login:() => setShowAuthFlow(true),
    getAccessToken, logout:handleLogOut, user:user ? {email:{address:user.email}} : null};
}
