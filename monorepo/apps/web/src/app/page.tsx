'use client';

// Entry gate (mirrors apps/mobile/src/app/index.tsx): first run → onboarding; otherwise Home.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { usePayStore, useStoreHydrated } from '@/store/usePayStore';

export default function Page() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const onboarded = usePayStore((s) => s.onboarded);

  useEffect(() => {
    if (hydrated) router.replace(onboarded ? '/home' : '/onboarding/welcome');
  }, [hydrated, onboarded, router]);

  // Decide on the client once persisted state is read; the app-frame background shows briefly.
  return null;
}
