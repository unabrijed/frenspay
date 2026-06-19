// Auth step. Mock mode: the original "Continue with Face ID" → handle.
// Privy mode (USE_PRIVY): email-OTP login → embedded wallet is created → handle.
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icons } from '@/components/icons';
import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { Field, GlyphCircle, Spacer } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { colors, type } from '@/lib/theme';
import { USE_PRIVY } from '@/services/env';
import { usePayStore } from '@/store/usePayStore';

export default function FaceID() {
  const router = useRouter();
  if (USE_PRIVY) return <EmailOtp onDone={() => router.replace('/onboarding/handle')} />;
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.fhead}>
        <BackButton onPress={() => router.back()} />
      </View>
      <View style={styles.center}>
        <GlyphCircle>
          <Icons.Face size={44} color={colors.muted} strokeWidth={1.6} />
        </GlyphCircle>
        <Txt style={type.onbH1}>Set up with Face ID</Txt>
        <Txt style={[type.lead, styles.sub, { fontSize: 15 }]}>
          No passwords, no seed phrases. Your account is secured on this device.
        </Txt>
      </View>
      <View style={styles.cta}>
        <Btn label="Continue with Face ID" onPress={() => router.push('/onboarding/handle')} />
      </View>
    </SafeAreaView>
  );
}

function EmailOtp({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const authStatus = usePayStore((s) => s.authStatus);
  const authError = usePayStore((s) => s.authError);
  const requestOtp = usePayStore((s) => s.requestOtp);
  const verifyOtp = usePayStore((s) => s.verifyOtp);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const sent = authStatus === 'codeSent';

  useEffect(() => {
    if (authStatus === 'signedIn') onDone();
  }, [authStatus, onDone]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.fhead}>
        <BackButton onPress={() => router.back()} />
      </View>
      <View style={styles.center}>
        <GlyphCircle>
          <Icons.Face size={44} color={colors.muted} strokeWidth={1.6} />
        </GlyphCircle>
        <Txt style={type.onbH1}>{sent ? 'Enter your code' : 'Set up your account'}</Txt>
        <Txt style={[type.lead, styles.sub, { fontSize: 15 }]}>
          {sent ? `We sent a 6-digit code to ${usePayStore.getState().authEmail}.` : 'No passwords, no seed phrases — just your email.'}
        </Txt>
        <Field style={{ marginTop: 4, alignSelf: 'stretch' }}>
          {sent ? (
            <TextInput
              style={[type.fieldText, styles.input]}
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              autoFocus
            />
          ) : (
            <TextInput
              style={[type.fieldText, styles.input]}
              value={email}
              onChangeText={setEmail}
              placeholder="you@email.com"
              placeholderTextColor={colors.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
          )}
        </Field>
        {authError ? <Txt style={[type.lead, { fontSize: 13, color: colors.danger }]}>{authError}</Txt> : null}
      </View>
      <View style={styles.cta}>
        {sent ? (
          <Btn label="Verify" disabled={code.length < 4} onPress={() => verifyOtp(code)} />
        ) : (
          <Btn label="Send code" disabled={!email.includes('@')} onPress={() => requestOtp(email.trim())} />
        )}
        <Spacer />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 26 },
  fhead: { paddingBottom: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  sub: { textAlign: 'center', maxWidth: 270 },
  input: { flex: 1, paddingVertical: 0 },
  cta: { gap: 13, alignItems: 'center' },
});
