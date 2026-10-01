'use client';

// Entry gate (mirrors apps/mobile/src/app/index.tsx): first run → onboarding; otherwise Home.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Splash } from '@/components/ui/Splash';
import { bootTrace } from '@/lib/boot';
import { bootRoute } from '@/lib/bootRoute';
import { usePayStore, useStoreHydrated } from '@/store/usePayStore';
import { PRELAUNCH_ENABLED } from '@/services/envConfig';
import Prelaunch from '@/components/prelaunch/Prelaunch';

export default function Page() {
  return PRELAUNCH_ENABLED ? <Prelaunch /> : <LegacyEntry />;
}

function LegacyEntry() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const onboarded = usePayStore((s) => s.onboarded);
  const handle = usePayStore((s) => s.handle);
  const authStatus = usePayStore((s) => s.authStatus);
  const authReady = usePayStore((s) => s.authReady);
  const probed = usePayStore((s) => s.firstLoadDone);

  // The landing gate sends verified codes here as /?invite=FP-XXXX-XXXX. Stash it before the
  // redirect strips the query — localStorage (not session) so "got a code today, signed up next
  // week" still prefills, and so it survives the Privy email-OTP round trip in between. The handle
  // step reads and clears it. `fpay:resumePay` is the naming precedent.
  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get('invite');
    if (invite) {
      try {
        localStorage.setItem('fpay:invite', invite.toUpperCase());
      } catch {
        /* storage blocked — manual entry still works */
      }
    }
  }, []);

  // Routing truth lives in lib/bootRoute — shared with the auth step, which used to decide the same
  // thing separately. A null dest means "we don't know yet": Privy hasn't resolved, or /me hasn't
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
