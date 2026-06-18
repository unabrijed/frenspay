// Welcome — first screen of the shortest-path-to-first-payment onboarding.
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, TextLink } from '@/components/ui/Button';
import { LogoXl } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

export default function Welcome() {
  const router = useRouter();
  const completeOnboarding = usePayStore((s) => s.completeOnboarding);
  const skip = () => {
    completeOnboarding();
    router.replace('/home');
  };
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.center}>
        <LogoXl />
        <Txt style={[type.onbH1, styles.h1]}>Pay like a local, anywhere you travel.</Txt>
        <Txt style={[type.lead, styles.sub, { fontSize: 15 }]}>One balance in dollars. Spend in rupees, instantly.</Txt>
      </View>
      <View style={styles.cta}>
        <Btn label="Get started" onPress={() => router.push('/onboarding/faceid')} />
        <TextLink label="I already have an account" onPress={skip} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas, paddingHorizontal: 24, paddingTop: 30, paddingBottom: 30 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  h1: { fontSize: 32, lineHeight: 36, textAlign: 'center', maxWidth: 260 },
  sub: { textAlign: 'center', maxWidth: 250 },
  cta: { gap: 13, alignItems: 'center' },
});
