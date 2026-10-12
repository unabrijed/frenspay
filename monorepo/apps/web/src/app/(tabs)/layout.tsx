'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { BottomNav } from '@/components/BottomNav';
import { Splash } from '@/components/ui/Splash';
import { usePayStore, useStoreHydrated } from '@/store/usePayStore';

// Shared chrome for the tab screens (home + activity): a scrolling content area above a
// fixed custom bottom nav. Mirrors the mobile (tabs) navigator.
//
// Also the onboarding GUARD for the tab area: a user who hasn't finished onboarding must never see
// /home or /activity (previously reachable by typing the URL). Once storage has hydrated, bounce a
// non-onboarded user back to the entry router (`/`), which re-routes them to the correct step.
export default function TabsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useStoreHydrated();
  const onboarded = usePayStore((s) => s.onboarded);

  useEffect(() => {
    if (hydrated && !onboarded) router.replace('/');
  }, [hydrated, onboarded, router]);

  // Hold the splash until we know the user is onboarded, so tab content never flashes before a
  // guard redirect (and never renders for a user who shouldn't see it).
  if (!hydrated || !onboarded) return <Splash />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}>{children}</div>
      <BottomNav
        active={pathname.startsWith('/activity') ? 'activity' : 'home'}
        onHome={() => router.push('/home')}
        onActivity={() => router.push('/activity')}
      />
    </div>
  );
}
