// Tab chrome (home + activity) above the custom bottom nav — and the onboarding GUARD for the tab
// area, plus the one-look invite reveal, exactly as the web's (tabs)/layout.tsx.
import { BottomNav, usePayStore, useStoreHydrated } from '@fpay/app';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { Splash } from '@/components/Splash';

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useStoreHydrated();
  const onboarded = usePayStore((s) => s.onboarded);
  const hasUnseenInvites = usePayStore((s) => s.invites.length > 0);

  useEffect(() => {
    if (hydrated && !onboarded) router.replace('/');
  }, [hydrated, onboarded, router]);

  useEffect(() => {
    if (hydrated && onboarded && hasUnseenInvites) router.replace('/invites');
  }, [hydrated, onboarded, hasUnseenInvites, router]);

  if (!hydrated || !onboarded) return <Splash />;

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={() => (
        <BottomNav
          active={pathname.startsWith('/activity') ? 'activity' : 'home'}
          onHome={() => router.push('/home')}
          onActivity={() => router.push('/activity')}
        />
      )}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity' }} />
    </Tabs>
  );
}
