'use client';

// AppProviders — mounts Privy only when USE_PRIVY (NEXT_PUBLIC_STAGE_PRIVY_APP_ID set). The
// dynamic import keeps the Privy SDK out of the bundle when it isn't configured (the dev-wallet
// path signs locally and never loads it), mirroring the mobile lazy-load.
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

import { Splash } from '@/components/ui/Splash';
import { LiveSync } from '@/hooks/useLiveSync';
import { USE_PRIVY } from '@/services/envConfig';

// `loading` shows the splash while the Privy chunk downloads on the client (ssr:false means it
// only renders client-side), so the post-hydration window is never a blank frame.
const PrivyRoot = dynamic(() => import('@/services/privy/PrivyRoot'), {
  ssr: false,
  loading: () => <Splash />,
});

export function AppProviders({ children }: { children: ReactNode }) {
  // LiveSync keeps balance/activity fresh while signed in (so received money appears live).
  const content = (
    <>
      <LiveSync />
      {children}
    </>
  );
  if (USE_PRIVY) return <PrivyRoot>{content}</PrivyRoot>;
  return content;
}
