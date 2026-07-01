'use client';

// Auth step (Privy): email-OTP login → embedded Solana wallet is created → handle.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { Icons } from '@/components/icons';
import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { Field, GlyphCircle, Spacer } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/Skeleton';
import { View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { Screen } from '@/components/ui/Screen';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

export default function FaceID() {
  return <EmailOtp />;
}

function EmailOtp() {
  const router = useRouter();
  const authStatus = usePayStore((s) => s.authStatus);
  const authError = usePayStore((s) => s.authError);
  const authEmail = usePayStore((s) => s.authEmail);
  const handle = usePayStore((s) => s.handle);
  const loaded = usePayStore((s) => s.firstLoadDone);
  const requestOtp = usePayStore((s) => s.requestOtp);
  const verifyOtp = usePayStore((s) => s.verifyOtp);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const sent = authStatus === 'codeSent';
  const signedIn = authStatus === 'signedIn';

  // Signed in: once the embedded wallet + backend identity have loaded, route by whether a handle
  // already exists — existing users skip straight to Home; brand-new users pick a handle.
  useEffect(() => {
    if (signedIn && loaded) router.replace(handle ? '/home' : '/onboarding/handle');
  }, [signedIn, loaded, handle, router]);

  // Reset the in-flight guard once the request settles (status change or error) so a
  // double-tap can't fire concurrent sendCode/loginWithCode calls.
  useEffect(() => {
    setSubmitting(false);
  }, [authStatus, authError]);

  // After the code verifies, Privy creates the embedded Solana wallet and we pull the account —
  // show a dedicated "setting up" state (no inputs, no progress gap) until routing kicks in.
  if (signedIn) {
    return (
      <Screen edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.center}>
          <GlyphCircle>
            <Icons.Face size={44} color={colors.muted} strokeWidth={1.6} />
          </GlyphCircle>
          <Txt style={type.onbH1}>Setting up your account</Txt>
          <Txt style={[type.lead, styles.sub, { fontSize: 15 }]}>Creating your secure wallet…</Txt>
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
          <Icons.Face size={44} color={colors.muted} strokeWidth={1.6} />
        </GlyphCircle>
        <Txt style={type.onbH1}>{sent ? 'Enter your code' : 'Set up your account'}</Txt>
        <Txt style={[type.lead, styles.sub, { fontSize: 15 }]}>
          {sent ? `We sent a 6-digit code to ${authEmail}.` : 'No passwords. Just your email.'}
        </Txt>
        <Field style={{ marginTop: 4, alignSelf: 'stretch' }}>
          {sent ? (
            <input
              style={sxInput}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoFocus
            />
          ) : (
            <input
              style={sxInput}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              type="email"
              autoCapitalize="none"
              autoFocus
            />
          )}
        </Field>
        {authError ? <Txt style={[type.lead, { fontSize: 13, color: colors.danger }]}>{authError}</Txt> : null}
      </View>
      <View style={styles.cta}>
        {sent ? (
          <Btn
            label={submitting ? 'Verifying…' : 'Verify'}
            disabled={code.length < 4 || submitting}
            onPress={() => {
              setSubmitting(true);
              verifyOtp(code);
            }}
          />
        ) : (
          <Btn
            label={submitting ? 'Sending…' : 'Send code'}
            disabled={!email.includes('@') || submitting}
            onPress={() => {
              setSubmitting(true);
              requestOtp(email.trim());
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
  input: { flex: 1, paddingTop: 0, paddingBottom: 0 },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;

const sxInput: CSSProperties = {
  ...type.fieldText,
  ...styles.input,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  minWidth: 0,
};
