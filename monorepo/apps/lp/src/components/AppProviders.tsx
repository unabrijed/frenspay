'use client';

// AppProviders — mounts Dynamic only when it is configured. The dynamic import keeps the SDK out of
// the bundle otherwise, and `loading` shows the splash while the chunk downloads so the
// post-hydration window is never a blank frame.
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

import { Splash } from '@/components/Splash';
import { USE_DYNAMIC, IS_LOCAL_ENV } from '@/services/envConfig';

const DynamicRoot = dynamic(() => import('@/services/dynamic/DynamicRoot'), {
  ssr: false,
  loading: () => <Splash />,
});

export function AppProviders({ children }: { children: ReactNode }) {
  if (USE_DYNAMIC) return <DynamicRoot>{children}</DynamicRoot>;
  if (!IS_LOCAL_ENV) return <main>Dynamic sign-in is not configured.</main>;
  return <>{children}</>;
}
