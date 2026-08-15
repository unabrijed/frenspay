'use client';

// AppProviders — mounts Privy only when it is configured. The dynamic import keeps the SDK out of
// the bundle otherwise, and `loading` shows the splash while the chunk downloads so the
// post-hydration window is never a blank frame.
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

import { Splash } from '@/components/Splash';
import { USE_PRIVY } from '@/services/envConfig';

const PrivyRoot = dynamic(() => import('@/services/privy/PrivyRoot'), {
  ssr: false,
  loading: () => <Splash />,
});

export function AppProviders({ children }: { children: ReactNode }) {
  if (USE_PRIVY) return <PrivyRoot>{children}</PrivyRoot>;
  return <>{children}</>;
}
