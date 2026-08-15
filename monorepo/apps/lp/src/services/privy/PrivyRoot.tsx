'use client';

// PrivyRoot — wraps the console in PrivyProvider + mounts the bridge. Default export so it can be
// dynamically imported only when USE_PRIVY, keeping the SDK out of the bundle otherwise.
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { Splash } from '@/components/Splash';
import { PRIVY_APP_ID, PRIVY_CLIENT_ID } from '@/services/envConfig';

import { PrivyBridge } from './PrivyBridge';

// Hold a splash until Privy rehydrates the session, so a reload doesn't flash the sign-in screen.
// Time-boxed: if the SDK is slow or the network is blocked, render anyway after ~4s — sign-in is
// the correct fallback and it snaps to the signed-in UI the moment `ready` arrives. A splash that
// outlasts a user's patience IS the "doesn't load until I refresh" bug.
const PRIVY_READY_TIMEOUT_MS = 4000;

function PrivyGate({ children }: { children: ReactNode }) {
  const { ready } = usePrivy();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (ready) return undefined;
    const t = setTimeout(() => setTimedOut(true), PRIVY_READY_TIMEOUT_MS);
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
        // Email, and nothing else — the same answer the wallet app gives. An external wallet would
        // be an account we can't fee-pay for or recover.
        loginMethods: ['email'],
        // Solana only. This console has no EVM surface: an LP signs a stake transfer and nothing
        // else. Provisioned at login rather than left to the bridge's manual createWallet(), whose
        // guard only resets on throw — a call that resolved without `wallets` populating would
        // silently park the session forever.
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' } },
      }}
    >
      <PrivyBridge />
      <PrivyGate>{children}</PrivyGate>
    </PrivyProvider>
  );
}
