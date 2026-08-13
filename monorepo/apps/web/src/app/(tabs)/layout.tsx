'use client';

import { useRouter } from 'next/navigation';
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
  const hydrated = useStoreHydrated();
  const onboarded = usePayStore((s) => s.onboarded);
  const hasUnseenInvites = usePayStore((s) => s.invites.length > 0);

  useEffect(() => {
    if (hydrated && !onboarded) router.replace('/');
  }, [hydrated, onboarded, router]);

  // The one-look invite reveal, guarded HERE rather than wired into the onboarding chain: /me only
  // returns the codes while they're unacknowledged, so this fires on whichever path reaches the
  // tabs first — a new user finishing funding, the mainnet fund-skip, or an account that predates
  // invite codes entirely and just got minted three on its next /me. One guard at the sink covers
  // every path in, same as the faucet guard in onboarding/fund.
  //
  // It lives at /invites, NOT under /onboarding/*: it isn't a step in the chain, and sitting in
  // that namespace read as one to anyone who saw the URL.
  useEffect(() => {
    if (hydrated && onboarded && hasUnseenInvites) router.replace('/invites');
  }, [hydrated, onboarded, hasUnseenInvites, router]);

  // Hold the splash until we know the user is onboarded, so tab content never flashes before a
  // guard redirect (and never renders for a user who shouldn't see it).
  if (!hydrated || !onboarded) return <Splash />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}>{children}</div>
      <BottomNav />
    </div>
  );
}
