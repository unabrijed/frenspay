// Welcome — first screen. Port of the web's onboarding/welcome/page.tsx.
import { bootRoute, usePayStore } from '@fpay/app';
import { Btn, colors, LogoXl, Screen, TextLink, Txt, type, View } from '@fpay/ui';
import { useRouter } from 'expo-router';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

export default function Welcome() {
  const router = useRouter();
  const authStatus = usePayStore((s) => s.authStatus);
  const handle = usePayStore((s) => s.handle);
  const onboarded = usePayStore((s) => s.onboarded);
  const loaded = usePayStore((s) => s.firstLoadDone);

  // A signed-in user has no business here — route them on once the session chain lands.
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
