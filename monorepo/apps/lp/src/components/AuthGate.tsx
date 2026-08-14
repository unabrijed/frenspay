'use client';

// AuthGate — the door. Four states, and the third is the one worth building carefully.
//
// This console does NOT create accounts. Applying needs a users row and tier-2 identity, and
// signing up needs an invite — both of which live in the wallet app. So someone who authenticates
// here with an address we've never seen gets told exactly that, rather than a half-signed-in shell
// that 403s on every call. Same posture as the admin console's "sign into the fpay app once".
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';

import { Btn, TextLink } from '@fpay/ui/Button';
import { Field, Spacer } from '@fpay/ui/primitives';
import { View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { colors, GUTTER, type } from '@fpay/ui/theme';

import { Splash } from '@/components/Splash';
import { friendlyError } from '@/lib/errors';
import { useLpStore } from '@/store/useLpStore';

function SignIn() {
  const auth = useLpStore((s) => s.auth);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setErr(friendlyError(e, 'That didn’t work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.scroll}>
        <Spacer />
        <Txt style={type.handle}>Settle payouts. Earn a spread.</Txt>
        <Txt style={[type.lead, { marginTop: 10, marginBottom: 24 }]}>
          Sign in with the email on your fpay account.
        </Txt>

        {!sent ? (
          <>
            <Field>
              <input
                style={inputStyle}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Spacer />
            <Btn
              label={busy ? 'Sending…' : 'Continue'}
              variant="ink"
              disabled={busy || !email.includes('@')}
              onPress={() => void run(() => auth!.sendCode(email.trim()), () => setSent(true))}
            />
          </>
        ) : (
          <>
            <Txt style={[type.inst, { marginBottom: 8 }]}>We sent a 6-digit code to {email}.</Txt>
            <Field>
              <input
                style={{ ...inputStyle, letterSpacing: 6 }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="······"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Spacer />
            <Btn
              label={busy ? 'Checking…' : 'Sign in'}
              variant="ink"
              disabled={busy || code.length < 6}
              onPress={() => void run(() => auth!.verifyCode(code))}
            />
            <View style={{ alignItems: 'center', marginTop: 12 }}>
              <TextLink label="Use a different email" onPress={() => { setSent(false); setCode(''); }} />
            </View>
          </>
        )}

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}
      </View>
    </Screen>
  );
}

function DeadEnd({ title, body }: { title: string; body: string }) {
  const auth = useLpStore((s) => s.auth);
  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.scroll}>
        <Spacer />
        <Txt style={type.handle}>{title}</Txt>
        <Txt style={[type.lead, { marginTop: 10 }]}>{body}</Txt>
        <Spacer />
        {/* Without a way out, the only escape from a dead end is clearing site data. */}
        <View style={{ alignItems: 'center' }}>
          <TextLink label="Sign out" onPress={() => void auth?.logout()} />
        </View>
      </View>
    </Screen>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const authStatus = useLpStore((s) => s.authStatus);
  const loaded = useLpStore((s) => s.loaded);
  const noAccount = useLpStore((s) => s.noAccount);
  const suspended = useLpStore((s) => s.suspended);

  if (authStatus === 'loading') return <Splash />;
  if (authStatus === 'signedOut') return <SignIn />;
  if (suspended) {
    return <DeadEnd title="Your account is paused" body="Contact support and we’ll sort it out." />;
  }
  if (noAccount) {
    return (
      <DeadEnd
        title="You need an fpay account first"
        body="This is the console for people who already use fpay. Open the fpay app, finish signing up there, then come back."
      />
    );
  }
  if (!loaded) return <Splash />;
  return <>{children}</>;
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  font: 'inherit',
  fontSize: 17,
  color: colors.ink,
};

const styles = {
  safe: { backgroundColor: colors.canvas },
  scroll: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    paddingLeft: GUTTER,
    paddingRight: GUTTER,
    paddingBottom: 28,
  },
} satisfies Record<string, CSSProperties>;
