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
  const handle = usePayStore((s) => s.handle);
  const authStatus = usePayStore((s) => s.authStatus);

  // Single source of routing truth — resumes a partially-onboarded user at the RIGHT step instead
  // of restarting from welcome (Privy persists the session, so `authStatus` re-resolves to
  // 'signedIn' on reload and `handle` is persisted once the handle step is done):
  //   onboarded            → /home
  //   signed in, has handle → /onboarding/fund     (verified + named; just needs first funds)
  //   signed in, no handle  → /onboarding/handle    (verified; needs a handle)
  //   otherwise             → /onboarding/welcome
  // Re-runs when authStatus flips to 'signedIn' after the bridge finishes, correcting the
  // welcome→handle case with at most a brief splash.
  useEffect(() => {
    if (!hydrated) return;
    const dest = onboarded
      ? '/home'
      : handle
        ? '/onboarding/fund'
        : authStatus === 'signedIn'
          ? '/onboarding/handle'
          : '/onboarding/welcome';
    bootTrace(`entry redirect → ${dest}`);
    router.replace(dest);
  }, [hydrated, onboarded, handle, authStatus, router]);

  // Show the splash during the hydrate-then-redirect window instead of a blank frame.
  return <Splash />;
}
