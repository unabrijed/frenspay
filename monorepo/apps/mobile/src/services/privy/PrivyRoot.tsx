// PrivyRoot — wraps the app in PrivyProvider + mounts the bridge. Default export so it can be
// React.lazy()'d from _layout. This module (and @privy-io/expo) loads ONLY when USE_PRIVY is set,
// so the Expo Go build never executes Privy's native modules.
import { PrivyProvider } from '@privy-io/expo';
import type { ReactNode } from 'react';

import { PRIVY_APP_ID, PRIVY_CLIENT_ID } from '../env';

import { PrivyBridge } from './PrivyBridge';

export default function PrivyRoot({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID || undefined}>
      <PrivyBridge />
      {children}
    </PrivyProvider>
  );
}
