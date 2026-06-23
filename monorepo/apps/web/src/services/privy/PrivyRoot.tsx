'use client';

// PrivyRoot — wraps the app in PrivyProvider + mounts the bridge. Default export so it can be
// dynamically imported only when USE_PRIVY (keeps Privy out of the mock-mode bundle).
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import type { ReactNode } from 'react';

import { LogoXl } from '@/components/ui/primitives';
import { Screen } from '@/components/ui/Screen';
import { View } from '@/components/ui/rn';
import { PRIVY_APP_ID, PRIVY_CLIENT_ID } from '@/services/env';

import { PrivyBridge } from './PrivyBridge';

// Hold a splash until Privy has rehydrated the session, so a reload doesn't flash the
// onboarding/login screen while `ready` is still false. If the session is gone, `ready`
// becomes true with no user and the app shows login (the correct fallback).
function PrivyGate({ children }: { children: ReactNode }) {
  const { ready } = usePrivy();
  if (ready) return <>{children}</>;
  return (
    <Screen edges={['top']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <LogoXl />
      </View>
    </Screen>
  );
}

export default function PrivyRoot({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID || undefined}>
      <PrivyBridge />
      <PrivyGate>{children}</PrivyGate>
    </PrivyProvider>
  );
}
