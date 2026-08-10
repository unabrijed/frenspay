'use client';

// PrivyRoot — wraps the app in PrivyProvider + mounts the bridge. Default export so it can be
// dynamically imported only when USE_PRIVY (keeps Privy out of the bundle when it isn't configured).
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { Splash } from '@/components/ui/Splash';
import { bootTrace } from '@/lib/boot';
import { PRIVY_APP_ID, PRIVY_CLIENT_ID } from '@/services/envConfig';

import { PrivyBridge } from './PrivyBridge';

bootTrace('privy chunk loaded');

// Hold a splash until Privy has rehydrated the session, so a reload doesn't flash the
// onboarding/login screen while `ready` is still false. If the session is gone, `ready`
// becomes true with no user and the app shows login (the correct fallback). Safety net: if Privy
// is slow/hangs on a cold load (SDK init / blocked network), stop blocking after ~4s and render
// anyway — the downstream login/onboarding is the correct fallback, and it snaps to the signed-in
// UI the moment `ready` arrives. 4s (not 9s) because users refresh long before 9s — that long
// blocking splash IS the "doesn't load until I refresh" symptom.
const PRIVY_READY_TIMEOUT_MS = 4000;

function PrivyGate({ children }: { children: ReactNode }) {
  const { ready } = usePrivy();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (ready) {
      bootTrace('privy ready');
      return;
    }
    const t = setTimeout(() => {
      bootTrace('privy ready TIMEOUT, rendering fallback');
      setTimedOut(true);
    }, PRIVY_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready]);

  if (ready || timedOut) return <>{children}</>;
  return <Splash />;
}

export default function PrivyRoot({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID || undefined}
      config={{
        // Inbound cross-chain (docs/19): the user's own EVM smart wallet is the deposit address.
        // Requires smart wallets enabled in the Privy dashboard + per-chain paymaster URLs.
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
      }}
    >
      <SmartWalletsProvider>
        <PrivyBridge />
        <PrivyGate>{children}</PrivyGate>
      </SmartWalletsProvider>
    </PrivyProvider>
  );
}
