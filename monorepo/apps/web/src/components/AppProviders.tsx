'use client';

// AppProviders — mounts Privy only when USE_PRIVY (NEXT_PUBLIC_STAGE_PRIVY_APP_ID set). The
// dynamic import keeps the Privy SDK out of the bundle in mock mode, mirroring the mobile lazy-load.
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

import { USE_PRIVY } from '@/services/env';

const PrivyRoot = dynamic(() => import('@/services/privy/PrivyRoot'), { ssr: false });

export function AppProviders({ children }: { children: ReactNode }) {
  if (USE_PRIVY) return <PrivyRoot>{children}</PrivyRoot>;
  return <>{children}</>;
}
