// PrivyRoot — wraps the app in PrivyProvider + mounts the bridge. Default export so it can be
// React.lazy()'d from _layout: this module (and @privy-io/expo's native modules) loads ONLY when
// USE_PRIVY is set. Holds a splash until Privy has rehydrated the session — bounded, like the web.
import { PrivyProvider, usePrivy } from '@privy-io/expo';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { Splash } from '@/components/Splash';
import { PRIVY_APP_ID, PRIVY_CLIENT_ID } from '@/services/envConfig';

import { PrivyBridge } from './PrivyBridge';

const PRIVY_READY_TIMEOUT_MS = 4000;

function PrivyGate({ children }: { children: ReactNode }) {
  const { isReady } = usePrivy();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isReady) return undefined;
    const t = setTimeout(() => setTimedOut(true), PRIVY_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [isReady]);
  if (isReady || timedOut) return <>{children}</>;
  return <Splash />;
}

export default function PrivyRoot({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID || undefined}>
      <PrivyBridge />
      <PrivyGate>{children}</PrivyGate>
    </PrivyProvider>
  );
}
