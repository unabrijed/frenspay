// Entry gate: where does this session belong? Same function as the web's entry router
// (lib/bootRoute) — a null answer holds the splash until Privy and /me have spoken.
import { bootRoute, platform, usePayStore, useStoreHydrated } from '@fpay/app';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { Splash } from '@/components/Splash';

export default function Index() {
  const router = useRouter();
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const hydrated = useStoreHydrated();
  const onboarded = usePayStore((s) => s.onboarded);
  const handle = usePayStore((s) => s.handle);
  const authStatus = usePayStore((s) => s.authStatus);
  const authReady = usePayStore((s) => s.authReady);
  const probed = usePayStore((s) => s.firstLoadDone);

  // A landing-page deep link (fpay://?invite=FP-XXXX-XXXX) stashes the code for the handle step.
  useEffect(() => {
    if (invite) void platform().storage.setItem('fpay:invite', String(invite).toUpperCase());
  }, [invite]);

  useEffect(() => {
    const dest = bootRoute({ hydrated, authReady, authStatus, probed, onboarded, handle });
    if (!dest) return;
    platform().trace(`entry redirect → ${dest}`);
    router.replace(dest);
  }, [hydrated, authReady, authStatus, probed, onboarded, handle, router]);

  return <Splash />;
}
