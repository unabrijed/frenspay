'use client';

// (tabs) — Home · Activity · Account share one frame: the page above, the tab bar beneath. No redirect
// gate here, on purpose: the profile can be null for a moment (a hard refresh, a failed /me), and
// bouncing a working partner off their queue for that would be worse than a blank tab. Home renders the
// "become a partner" block inline when there is no partner account; the bar stays hidden until there is.
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { Icons } from '@fpay/ui/icons';
import { View } from '@fpay/ui/rn';
import { TabBar } from '@fpay/ui/TabBar';
import { useLpStore } from '@/store/useLpStore';

const TABS = [
  { key: 'home', label: 'Home', icon: (c: string) => <Icons.Home size={22} color={c} /> },
  { key: 'activity', label: 'Activity', icon: (c: string) => <Icons.Activity size={22} color={c} /> },
  { key: 'account', label: 'Account', icon: (c: string) => <Icons.Person size={22} color={c} /> },
];

export default function TabsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const merchant = useLpStore((s) => s.merchant);
  const active = pathname.startsWith('/activity') ? 'activity' : pathname.startsWith('/account') ? 'account' : 'home';
  return (
    <View style={{ flex: 1, minHeight: 0, flexDirection: 'column' }}>
      {/* Each page brings its own Screen + ScrollView (invariant 49); this column only adds the bar. */}
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'column' }}>{children}</View>
      {merchant ? <TabBar items={TABS} active={active} onPress={(k) => router.push(k === 'home' ? '/' : `/${k}`)} /> : null}
    </View>
  );
}
