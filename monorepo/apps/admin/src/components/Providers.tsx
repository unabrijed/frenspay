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
//
// The Privy app is keyed to the SELECTED BACKEND, not baked in at build time — stage and prod are
// separate Privy apps and neither backend accepts the other's tokens. See PRIVY_APP_IDS.
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useEffect, useState, type ReactNode } from 'react';

import { EnvSwitch } from '@/components/EnvSwitch';
import { Denied } from '@/components/ui';
import { api, ApiError, setAuthToken, setTokenRefresher } from '@/services/api';
import { apiHost, getApiMode } from '@/services/apiMode';
import { isProduction, PRIVY_APP_IDS, PRIVY_CLIENT_IDS, type ApiMode } from '@/services/envConfig';

/** What /me said about this account.
 *  'absent'    = the token verified, and this backend has no row for it.
 *  'wrong_env' = the token did not verify AT ALL, so no row was ever looked up. Almost always the
 *                console pointed at one backend with a session from the other one's Privy app. */
type Access = 'checking' | 'admin' | 'denied' | 'absent' | 'wrong_env' | 'error';

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
      // Signed in, but not usable here — and WHICH of the two is the whole diagnosis, so don't
      // collapse them. requireUserId raises 'no_account' when the token verified and this database
      // has no row (the console cannot create one; it never calls /auth/sync), and a bare
      // 'unauthorized' when the token itself was refused — which on a console that drives two
      // backends means the session belongs to the other one's Privy app. Reading both off `code`
      // needs api.ts's `message` handling; without it Fastify's generic "Unauthorized" made these
      // indistinguishable, and every rejected token was reported as a missing profile.
      .catch((e) => {
        if (!live) return;
        if (!(e instanceof ApiError)) return setAccess('error');
        if (e.code === 'no_account' || e.status === 404) return setAccess('absent');
        if (e.status === 401) return setAccess('wrong_env');
        setAccess('error');
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
        {/* WHICH backend you are about to sign into, before you sign in — this decides which Privy
            app mints the token, so getting it wrong here is what the wrong_env screen is for. */}
        <Target />
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
  const { logout, user } = usePrivy();
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
    // the environment and not the account, and the two used to print the same sentence.
    wrong_env: {
      title: 'Wrong environment',
      copy: 'This backend refused the session. It uses a different Privy app than the one you signed in with, so switch the target below — or sign out and back in to get a token it will accept.',
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

/** Sidebar sign-out. Only meaningful under Privy; hidden in dev-shim mode — SignOutInner calls
 *  usePrivy(), which throws when no provider is above it, and the shim path renders children with no
 *  provider at all. The condition has to be the SAME one Providers used to decide that, which is now
 *  per-target, so read the mode the same way (on mount, never guessed server-side). */
export function SignOut() {
  const [appId, setAppId] = useState('');
  useEffect(() => setAppId(PRIVY_APP_IDS[getApiMode()]), []);
  if (!appId) return null;
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
  // Resolve the target BEFORE mounting Privy. The mode lives in localStorage, so a server render
  // would guess 'stage', mount PrivyProvider with the stage app id, and rehydrate into a prod
  // session — the provider would be holding one app's config and the other app's token. Same
  // reasoning as the mode read in EnvSwitch, with more at stake. setApiMode reloads, so a switch
  // re-enters here cleanly rather than trying to swap appId under a live provider.
  const [mode, setMode] = useState<ApiMode | null>(null);
  useEffect(() => setMode(getApiMode()), []);
  if (!mode) return <div className="flex min-h-screen items-center justify-center text-[13px] text-muted">Loading…</div>;

  const appId = PRIVY_APP_IDS[mode];
  // No Privy app for this target. In dev that is the intended x-dev-user-id shim path and children
  // render directly, exactly as before. In a BUILT bundle it is a missing variable, and this app's
  // stated rule is that such a misconfiguration must never be silent (envConfig.ts) — silence here
  // means the console renders, sends no credential, and 401s on every panel, which reads as a broken
  // backend. The switch is offered because the other target may well be configured.
  if (!appId) {
    if (!isProduction) return <>{children}</>;
    return (
      <Denied
        title="Not configured"
        msg={`No Privy app is configured for the ${mode} target, so this console cannot sign anyone in against it. Set the ${mode === 'prod' ? 'NEXT_PUBLIC_PRIVY_APP_ID' : 'NEXT_PUBLIC_STAGE_PRIVY_APP_ID'} variable and redeploy — NEXT_PUBLIC_* is inlined at build time.`}
      >
        <Target />
      </Denied>
    );
  }
  return (
    <PrivyProvider
      appId={appId}
      clientId={PRIVY_CLIENT_IDS[mode] || undefined}
      config={{
        // Email, and nothing else — the same policy web states at PrivyRoot.tsx. Without it this
        // console's login() modal renders whatever the Privy dashboard happens to allow, which made
        // it the one place in the repo a wallet login could start. Everything else here already
        // said "no wallets"; this is the login door saying it too.
        loginMethods: ['email'],
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
