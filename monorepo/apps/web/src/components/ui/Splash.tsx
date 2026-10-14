'use client';

// Splash — the LogoXl-on-Screen loading view shown during boot/hydration/navigation. Single
// source so DynamicGate (session rehydration), the root page, the dynamic() fallback, and
// loading.tsx all show the identical screen instead of a blank frame.
//
// Slow connections keep their pending session intact; recovery is an explicit user action.
import { useEffect, useState } from 'react';

import { LogoXl } from '@/components/ui/primitives';
import { Screen } from '@/components/ui/Screen';
import { View } from '@/components/ui/rn';
import { bootRecoverReload, SPLASH_WATCHDOG_MS } from '@/lib/boot';

export function Splash() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SPLASH_WATCHDOG_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <Screen edges={['top']}>
      {/* The animated mark is the only visual loading indicator. */}
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        role="status" aria-label={slow ? 'Taking a little longer' : 'Loading'}
      >
        <LogoXl state="joining" />
        {slow && <p>Taking a little longer…</p>}
        {slow && <button type="button" onClick={() => bootRecoverReload('user-retry')}>Try again</button>}
      </View>
    </Screen>
  );
}
