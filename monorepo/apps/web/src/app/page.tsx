'use client';

// Entry gate (mirrors apps/mobile/src/app/index.tsx): first run → onboarding; otherwise Home.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Splash } from '@/components/ui/Splash';
import { bootTrace } from '@/lib/boot';
import { bootRoute } from '@/lib/bootRoute';
import { usePayStore, useStoreHydrated } from '@/store/usePayStore';

export default function Page() {
  return <ProductEntry />;
}

function ProductEntry() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const onboarded = usePayStore((s) => s.onboarded);
  const handle = usePayStore((s) => s.handle);
  const authStatus = usePayStore((s) => s.authStatus);
  const authReady = usePayStore((s) => s.authReady);
  const probed = usePayStore((s) => s.firstLoadDone);

  // Routing truth lives in lib/bootRoute — shared with the auth step, which used to decide the same
  // thing separately. A null dest means "we don't know yet": Dynamic hasn't resolved, or /me hasn't
  // answered. Holding the splash through that window is the fix for existing users being sent to
  // pick a handle they already have — this page used to guess from localStorage and redirect away
  // before the server could contradict it.
  useEffect(() => {
    const dest = bootRoute({ hydrated, authReady, authStatus, probed, onboarded, handle });
    if (!dest) return;
    bootTrace(`entry redirect → ${dest}`);
    router.replace(dest);
  }, [hydrated, authReady, authStatus, probed, onboarded, handle, router]);

  // Show the splash during the hydrate-then-redirect window instead of a blank frame.
  return <Splash />;
}
