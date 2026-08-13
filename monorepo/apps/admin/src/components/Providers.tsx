'use client';

// Providers.tsx — minimal Privy for the console: login + access token, NOTHING else. No embedded
// wallets, no smart wallets, no signers — admin never moves money client-side.
//
// The gate asks BOTH questions. Privy answers "who are you"; GET /me answers "are you an operator",
// and the console mounts for nobody else. It used to render for anyone who could log in: every
// panel still 403'd, so no data escaped, but a stranger got the shell and the nav — which is a map
// of the operation. The server remains the authority (requireAdmin); this is a gate over it, never
// a replacement for it.
//
// Without Privy configured (local dev), requests fall back to the x-dev-user-id shim in api.ts,
// so children render directly.
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useEffect, useState, type ReactNode } from 'react';

import { Denied } from '@/components/ui';
import { api, ApiError, setAuthToken, setTokenRefresher } from '@/services/api';
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, USE_PRIVY } from '@/services/envConfig';

/** What /me said about this account. 'absent' = authenticated with no row on THIS environment. */
type Access = 'checking' | 'admin' | 'denied' | 'absent' | 'error';

function AuthGate({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  // Children only mount once a token is actually in the api client — otherwise the first page
  // fetch races the token effect and burns a 401 round-trip on every load.
  const [tokenReady, setTokenReady] = useState(false);
  const [access, setAccess] = useState<Access>('checking');

  useEffect(() => {
    if (!authenticated) {
      setAuthToken(null);
      setTokenRefresher(null);
      setTokenReady(false);
      setAccess('checking');
      return;
    }
    setTokenRefresher(getAccessToken);
    void getAccessToken().then((t) => {
      setAuthToken(t);
      setTokenReady(true);
    });
  }, [authenticated, getAccessToken]);

  // The authorization half. `role` here is the EFFECTIVE role (backend auth.ts effectiveRole), so a
  // root admin named in ADMIN_EMAILS passes even though their users.role still reads 'user'.
  useEffect(() => {
    if (!tokenReady) return;
    let live = true;
    void api
      .me()
      .then((me) => live && setAccess(me.role === 'admin' ? 'admin' : 'denied'))
      // 401/404 is its own state: signed in with no account here at all. The console cannot create
      // one — it never calls /auth/sync — so this needs an instruction, not an error banner.
      .catch((e) => {
        if (!live) return;
        const s = e instanceof ApiError ? e.status : 0;
        setAccess(s === 401 || s === 404 ? 'absent' : 'error');
      });
    return () => {
      live = false;
    };
  }, [tokenReady]);

  if (!ready) {
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
      </div>
    );
  }
  if (!tokenReady || access === 'checking') {
    return <div className="flex min-h-screen items-center justify-center text-[13px] text-muted">Signing in…</div>;
  }
  if (access !== 'admin') {
    return <NoAccess kind={access} />;
  }
  return <>{children}</>;
}

/** The three ways in that aren't. Each says what to do next and offers a way to swap accounts —
 *  a dead end with no sign-out means clearing site data to try another address. */
function NoAccess({ kind }: { kind: Exclude<Access, 'checking' | 'admin'> }) {
  const { logout, user } = usePrivy();
  const copy = {
    // undefined → Denied's own wording, the same sentence the ten pages show on a 403.
    denied: undefined,
    absent:
      'This account has no profile on this environment yet. Sign into the fpay app once with this address, then come back.',
    error:
      'Could not verify this account against the API. Check that the console is pointed at a reachable backend, then retry.',
  }[kind];
  return (
    <Denied msg={copy}>
      {user?.email?.address ? <p className="mt-3 text-[12px] text-muted">Signed in as {user.email.address}</p> : null}
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

/** Sidebar sign-out. Only meaningful under Privy; hidden in dev-shim mode. */
export function SignOut() {
  if (!USE_PRIVY) return null;
  return <SignOutInner />;
}

function SignOutInner() {
  const { logout, user } = usePrivy();
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
  if (!USE_PRIVY) return <>{children}</>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID || undefined}
      config={{
        embeddedWallets: {
          ethereum: { createOnLogin: 'off' },
          solana: { createOnLogin: 'off' },
        },
      }}
    >
      <AuthGate>{children}</AuthGate>
    </PrivyProvider>
  );
}
