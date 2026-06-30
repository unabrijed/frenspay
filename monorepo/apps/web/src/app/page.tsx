'use client';

// Entry gate (mirrors apps/mobile/src/app/index.tsx): first run → onboarding; otherwise Home.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Splash } from '@/components/ui/Splash';
import { bootTrace } from '@/lib/boot';
import { usePayStore, useStoreHydrated } from '@/store/usePayStore';

export default function Page() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const onboarded = usePayStore((s) => s.onboarded);

  useEffect(() => {
    if (hydrated) {
      bootTrace(`entry redirect → ${onboarded ? '/home' : '/onboarding/welcome'}`);
      router.replace(onboarded ? '/home' : '/onboarding/welcome');
    }
  }, [hydrated, onboarded, router]);

  // Show the splash during the hydrate-then-redirect window instead of a blank frame.
  return <Splash />;
}
