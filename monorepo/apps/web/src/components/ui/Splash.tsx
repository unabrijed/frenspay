'use client';

// Splash — the LogoXl-on-Screen loading view shown during boot/hydration/navigation. Single
// source so PrivyGate (session rehydration), the root page, the dynamic() fallback, and
// loading.tsx all show the identical screen instead of a blank frame.
//
// Because every loading state funnels through here, a Splash that stays mounted past
// SPLASH_WATCHDOG_MS means the boot genuinely stalled — the watchdog then does one guarded,
// cache-busting reload (the same recovery the user does by hand), converting "stuck until I
// refresh" into automatic self-heal. A normal boot unmounts the Splash well before the ceiling,
// clearing the timer, so this never fires on a healthy load.
import { useEffect } from 'react';

import { LogoXl } from '@/components/ui/primitives';
import { Screen } from '@/components/ui/Screen';
import { View } from '@/components/ui/rn';
import { bootRecoverReload, SPLASH_WATCHDOG_MS } from '@/lib/boot';

export function Splash() {
  useEffect(() => {
    const t = setTimeout(() => bootRecoverReload('splash-stuck'), SPLASH_WATCHDOG_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <Screen edges={['top']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <LogoXl />
      </View>
    </Screen>
  );
}
