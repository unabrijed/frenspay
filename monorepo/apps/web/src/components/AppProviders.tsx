'use client';

// AppProviders — mounts Privy only when USE_PRIVY (NEXT_PUBLIC_PRIVY_APP_ID set). The
// dynamic import keeps the Privy SDK out of the bundle when it isn't configured (the dev-wallet
// path signs locally and never loads it), mirroring the mobile lazy-load.
import { configure, LiveSync } from '@fpay/app';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Splash } from '@/components/ui/Splash';
import { webPlatform } from '@/platform';
import { IS_LOCAL_ENV, USE_PRIVY, SIMULATION_MODE, CAMPAIGN_AUTH_PROVIDER } from '@/services/envConfig';

// Boot the product BEFORE any render: this module is imported by the root layout, so it evaluates
// ahead of every route. configure() hands @fpay/app the web's storage/env/etc. and hydrates the store.
configure(webPlatform);

// `loading` shows the splash while the Privy chunk downloads on the client (ssr:false means it
// only renders client-side), so the post-hydration window is never a blank frame.
const PrivyRoot = dynamic(() => import('@/services/privy/PrivyRoot'), {
  ssr: false,
  loading: () => <Splash />,
});

const DynamicRoot = dynamic(() => import('@/services/dynamic/DynamicRoot'), {ssr: false, loading: () => <Splash />});

export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (SIMULATION_MODE && CAMPAIGN_AUTH_PROVIDER === 'dynamic' && !['/wallet-recovery', '/legacy-wallet'].includes(pathname))
    return <DynamicRoot>{children}</DynamicRoot>;
  // LiveSync keeps balance/activity fresh while signed in (so received money appears live).
  const content = (
    <>
      {!SIMULATION_MODE && <LiveSync />}
      {children}
    </>
  );
  if (USE_PRIVY) return <PrivyRoot>{content}</PrivyRoot>;
  if (['/wallet-recovery', '/legacy-wallet'].includes(pathname)) return <main style={{padding:32}}><h1>Wallet recovery is unavailable on this environment</h1><p>Privy sign-in must be configured to access your previous wallet.</p><a href="/">Back to Frenspay</a></main>;
  if (!IS_LOCAL_ENV) return <main style={{ padding: 32 }}><h1>Sign-in is temporarily unavailable</h1><p>Please try again shortly.</p></main>;
  return content;
}
