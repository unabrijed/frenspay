import type { ReactNode } from 'react';

import { BottomNav } from '@/components/BottomNav';

// Shared chrome for the tab screens (home + activity): a scrolling content area above a
// fixed custom bottom nav. Mirrors the mobile (tabs) navigator.
export default function TabsLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}>{children}</div>
      <BottomNav />
    </div>
  );
}
