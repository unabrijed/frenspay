'use client';

// AuthGate — the door. Four states, and the third is the one worth building carefully.
//
// This console finishes account setup itself. A verified email with no users row on this
// environment — a brand-new partner, or an existing one whose Privy DID rotated with the app
// (DEPLOY.stage.md §One Privy app) — lands on FinishSetup, which calls the same POST /auth/sync the
// wallet app does: the server canonicalizes the handle, asks for an invite only when it must
// (inviteRequired — an existing person matched by email pays nothing), adopts an existing row by
// email, and moves a partner's release address to the new wallet. Until 2026-09-01 this was a dead
// end that sent people to the wallet app first; after the DID rotation that locked out every
// existing partner, and the workaround was handing them the payer app's gate key.
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';

import type { MeResponse } from '@fpay/shared';

import { Btn, TextLink } from '@fpay/ui/Button';
import { Field, Spacer } from '@fpay/ui/primitives';
import { View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { colors, GUTTER, type } from '@fpay/ui/theme';

import { Splash } from '@/components/Splash';
import { friendlyError } from '@/lib/errors';
import { ApiError, req } from '@/services/api';
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
          Sign in with your email.
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

// Server codes meaning "the invite gate stopped you" — the only case where a field appears that
// wasn't there before. Everything else is a handle problem, fixed in the field they already have.
const GATE_CODES = new Set(['invite_required', 'invalid_invite']);

/**
 * The third state: signed in, no account here. One screen, one call — the same POST /auth/sync the
 * wallet app's handle step makes. The handle is asked for rather than derived from the email: it is
 * immutable and every payer can resolve it, so deriving would publish the email's local part
 * forever. It is discarded when the server adopts an existing account (a DID that rotated with the
 * Privy app) and permanent when it creates one, and nothing can tell the two apart before the call —
 * so the copy promises both honestly, and a mismatch on the way back becomes a "welcome back".
 */
function FinishSetup() {
  const walletAddress = useLpStore((s) => s.walletAddress);
  const load = useLpStore((s) => s.load);
  const notify = useLpStore((s) => s.notify);
  const auth = useLpStore((s) => s.auth);
  const [handle, setHandle] = useState('');
  const [code, setCode] = useState('');
  // Hidden until the server asks: the common case after a Privy-app migration is an existing
  // partner, and an invite box would tell them they are signing up fresh.
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Mirror the server's canonical form (lowercase, [a-z0-9_.]) so what you see is what registers.
  const clean = handle.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_.]/g, '');

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const trimmed = code.trim();
      const me = await req<MeResponse>('/auth/sync', {
        method: 'POST',
        body: JSON.stringify({ handle: `@${clean}`, walletAddress, ...(trimmed ? { inviteCode: trimmed } : {}) }),
      });
      // load() clears noAccount on a good /me. The explicit clear covers a /me hiccup right after a
      // good sync, which would otherwise bounce a freshly made account straight back to this screen.
      await load();
      useLpStore.setState({ noAccount: false });
      // Adoption: the server handed back an existing account under its own handle and ignored the
      // one typed here. Say so, or the old handle on the next screen reads as a bug.
      if (me.handle !== `@${clean}`) notify(`Welcome back, ${me.handle}`);
    } catch (e) {
      if (e instanceof ApiError && GATE_CODES.has(e.code)) setNeedsCode(true);
      setErr(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.scroll}>
        <Spacer />
        <Txt style={type.handle}>Finish setting up</Txt>
        <Txt style={[type.lead, { marginTop: 10, marginBottom: 24 }]}>
          Choose the name people see when they pay you. If you’ve used fpay before with this email,
          we’ll keep the one you have.
        </Txt>
        <Field>
          <Txt style={[type.lead, { color: colors.muted }]}>@</Txt>
          <input
            style={inputStyle}
            value={clean}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="yourname"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </Field>
        <Txt style={[type.inst, { marginTop: 8 }]}>Can’t be changed later.</Txt>
        {needsCode ? (
          <>
            <Spacer />
            <Field>
              <input
                style={{ ...inputStyle, letterSpacing: 1 }}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Invite code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
            </Field>
          </>
        ) : null}
        <Spacer />
        <Btn
          label={busy ? 'Saving…' : 'Continue'}
          variant="ink"
          disabled={busy || clean.length < 3 || (needsCode && !code.trim())}
          onPress={() => void submit()}
        />
        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}
        <View style={{ alignItems: 'center', marginTop: 12 }}>
          <TextLink label="Sign out" onPress={() => void auth?.logout()} />
        </View>
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
  if (noAccount) return <FinishSetup />;
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
