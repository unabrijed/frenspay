// Auth step (Dynamic): email-OTP login → embedded Solana wallet → handle. Port of the web's
// onboarding/faceid/page.tsx.
import { bootRoute, Skeleton, usePayStore } from '@fpay/app';
import { isValidEmail, normalizeEmail } from '@fpay/shared';
import { BackButton, Btn, CodeInput, colors, Field, GlyphCircle, Icons, Input, Screen, Spacer, Txt, type, View } from '@fpay/ui';
import { useRouter } from 'expo-router';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

export default function FaceID() {
  const router = useRouter();
  const authStatus = usePayStore((s) => s.authStatus);
  const authError = usePayStore((s) => s.authError);
  const authEmail = usePayStore((s) => s.authEmail);
  const handle = usePayStore((s) => s.handle);
  const onboarded = usePayStore((s) => s.onboarded);
  const loaded = usePayStore((s) => s.firstLoadDone);
  const requestOtp = usePayStore((s) => s.requestOtp);
  const verifyOtp = usePayStore((s) => s.verifyOtp);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const sent = authStatus === 'codeSent';
  const signedIn = authStatus === 'signedIn';

  // Signed in: route on what the SERVER said — existing users to Home, brand-new ones to a handle.
  useEffect(() => {
    const dest = bootRoute({ hydrated: true, authReady: true, authStatus, probed: loaded, onboarded, handle });
    if (signedIn && dest) router.replace(dest);
  }, [signedIn, authStatus, loaded, onboarded, handle, router]);

  useEffect(() => {
    setSubmitting(false);
  }, [authStatus, authError]);

  if (signedIn) {
    return (
      <Screen edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.center}>
          <GlyphCircle>
            <Icons.Face size={44} color={colors.muted} />
          </GlyphCircle>
          <Txt style={type.onbH1}>Setting up your account</Txt>
          <Txt style={[type.lead, styles.sub, { fontSize: 15 }]}>Getting things ready…</Txt>
          <Skeleton w={168} h={6} r={999} style={{ marginTop: 4 }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.fhead}>
        <BackButton onPress={() => router.back()} />
      </View>
      <View style={styles.center}>
        <GlyphCircle>
          <Icons.Face size={44} color={colors.muted} />
        </GlyphCircle>
        <Txt style={type.onbH1}>{sent ? 'Enter your code' : 'Set up your account'}</Txt>
        <Txt style={[type.lead, styles.sub, { fontSize: 15 }]}>
          {sent ? `We sent a 6-digit code to ${authEmail}.` : 'No passwords. Just your email.'}
        </Txt>
        <Field style={{ marginTop: 4, alignSelf: 'stretch' }}>
          {sent ? (
            <CodeInput value={code} onChange={setCode} disabled={submitting}/>
          ) : (
            <Input value={email} onChangeText={setEmail} placeholder="you@email.com" keyboardType="email" autoComplete="email" autoFocus style={styles.input} />
          )}
        </Field>
        {authError ? <Txt style={[type.lead, { fontSize: 13, color: colors.danger }]}>{authError}</Txt> : null}
      </View>
      <View style={styles.cta}>
        {sent ? (
          <Btn
            label={submitting ? 'Verifying…' : 'Verify'}
            disabled={code.length !== 6 || submitting}
            pending={submitting}
            onPress={() => {
              setSubmitting(true);
              verifyOtp(code);
            }}
          />
        ) : (
          <Btn
            label={submitting ? 'Sending…' : 'Send code'}
            disabled={!isValidEmail(email) || submitting}
            pending={submitting}
            onPress={() => {
              setSubmitting(true);
              requestOtp(normalizeEmail(email));
            }}
          />
        )}
        <Spacer />
      </View>
    </Screen>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas, paddingLeft: 24, paddingRight: 24, paddingTop: 8, paddingBottom: 26 },
  fhead: { paddingBottom: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  sub: { textAlign: 'center', maxWidth: 270 },
  input: { ...type.fieldText, flex: 1, minWidth: 0 },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
