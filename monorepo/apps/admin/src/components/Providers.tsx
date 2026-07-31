'use client';

// Providers.tsx — minimal Privy for the console: login + access token, NOTHING else. No embedded
// wallets, no smart wallets, no signers — admin never moves money client-side. Authorization is
// server-side (requireAdmin 403s non-admins); this gate only establishes identity.
//
// Without Privy configured (local dev), requests fall back to the x-dev-user-id shim in api.ts,
// so children render directly.
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useEffect, useState, type ReactNode } from 'react';

import { setAuthToken, setTokenRefresher } from '@/services/api';
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, USE_PRIVY } from '@/services/env';

function AuthGate({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  // Children only mount once a token is actually in the api client — otherwise the first page
  // fetch races the token effect and burns a 401 round-trip on every load.
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    if (!authenticated) {
      setAuthToken(null);
      setTokenRefresher(null);
      setTokenReady(false);
      return;
    }
    setTokenRefresher(getAccessToken);
    void getAccessToken().then((t) => {
      setAuthToken(t);
      setTokenReady(true);
    });
  }, [authenticated, getAccessToken]);

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
  if (!tokenReady) {
    return <div className="flex min-h-screen items-center justify-center text-[13px] text-muted">Signing in…</div>;
  }
  return <>{children}</>;
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
