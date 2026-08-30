'use client';

// Welcome — first screen of the shortest-path-to-first-payment onboarding.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

import { Btn, TextLink } from '@/components/ui/Button';
import { LogoXl } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { Screen } from '@/components/ui/Screen';
import { bootRoute } from '@/lib/bootRoute';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

export default function Welcome() {
  const router = useRouter();
  const authStatus = usePayStore((s) => s.authStatus);
  const handle = usePayStore((s) => s.handle);
  const onboarded = usePayStore((s) => s.onboarded);
  const loaded = usePayStore((s) => s.firstLoadDone);

  // A signed-in user has no business here. The entry router can land one on this screen when the
  // bridge's session chain is still in flight at its 5 s fallback (slow cold load); when the chain
  // lands, route them on — same decision, same function as the entry router and faceid.
  useEffect(() => {
    const dest = bootRoute({ hydrated: true, authReady: true, authStatus, probed: loaded, onboarded, handle });
    if (authStatus === 'signedIn' && dest) router.replace(dest);
  }, [authStatus, loaded, onboarded, handle, router]);

  return (
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.center}>
        <LogoXl />
        <Txt style={[type.onbH1, styles.h1]}>Pay like a local, anywhere you travel.</Txt>
        <Txt style={[type.lead, styles.sub, { fontSize: 15 }]}>One balance in dollars. Spend in rupees, instantly.</Txt>
      </View>
      <View style={styles.cta}>
        <Btn label="Get started" onPress={() => router.push('/onboarding/faceid')} />
        {/* Existing users sign in with the same email-OTP entry; faceid routes them straight to Home
            once their account (handle) loads. (Already signed in? The effect above skips this.) */}
        <TextLink label="I already have an account" onPress={() => router.push('/onboarding/faceid')} />
      </View>
    </Screen>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas, paddingLeft: 24, paddingRight: 24, paddingTop: 30, paddingBottom: 30 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  h1: { fontSize: 32, lineHeight: '36px', textAlign: 'center', maxWidth: 260 },
  sub: { textAlign: 'center', maxWidth: 250 },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
