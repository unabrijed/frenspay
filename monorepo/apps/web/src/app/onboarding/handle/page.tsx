'use client';

// Choose handle (Privy) — real input + availability check (GET /users/resolve) + /auth/sync
// (upserts the user + their embedded wallet). fpay "Choose Handle" layout.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { Icons } from '@/components/icons';
import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { Splash } from '@/components/ui/Splash';
import { View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { Screen } from '@/components/ui/Screen';
import { friendlyError } from '@/lib/errors';
import { colors, type } from '@/lib/theme';
import { ApiError } from '@/services/api';
import { LANDING_URL } from '@/services/envConfig';
import { wallet } from '@/services/wallet';
import { usePayStore, useStoreHydrated } from '@/store/usePayStore';

// Server codes meaning "the invite gate stopped you", as opposed to a handle problem they can fix here.
const GATE_CODES = new Set(['invite_required', 'invalid_invite']);

export default function Handle() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const authStatus = usePayStore((s) => s.authStatus);

  // Step guard: this screen calls /auth/sync (needs the signed-in wallet). If it's reached without
  // a signed-in session (direct URL / reload before the Privy bridge re-signs in), bounce to the
  // entry router, which re-routes to the correct step once auth resolves.
  useEffect(() => {
    if (hydrated && authStatus !== 'signedIn') router.replace('/');
  }, [hydrated, authStatus, router]);
  if (!hydrated || authStatus !== 'signedIn') return <Splash />;

  return <HandlePrivy onDone={() => router.push('/onboarding/fund')} />;
}

function HandlePrivy({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const authSync = usePayStore((s) => s.authSync);
  const [h, setH] = useState('');
  const [code, setCode] = useState('');
  const [avail, setAvail] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // True once the invite gate (not a handle problem) is what blocked them — the only case where
  // there is nothing they can do on this screen, so we offer the f list instead of a dead end.
  const [gated, setGated] = useState(false);
  // Mirror the server's canonical form (lowercase, [a-z0-9_.]) so what you see is what registers.
  const clean = h.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_.]/g, '');

  // Prefill the code stashed by the entry router (/?invite=FP-XXXX-XXXX, set by the landing gate).
  // Effect, not initializer — localStorage isn't there during SSR and an initializer would mismatch
  // hydration. The field stays editable: someone can reach the app directly, without the landing
  // page ever having seen their code.
  useEffect(() => {
    try {
      const stashed = localStorage.getItem('fpay:invite');
      if (stashed) setCode(stashed);
    } catch {
      /* storage blocked */
    }
  }, []);

  // Debounced availability check via the resolve endpoint (null result = available).
  useEffect(() => {
    if (clean.length < 3) {
      setAvail(null);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const found = await wallet.resolveHandle('@' + clean);
        if (active) setAvail(found === null);
      } catch {
        if (active) setAvail(null);
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [clean]);

  const onContinue = async () => {
    setErr(null);
    setGated(false);
    setBusy(true);
    try {
      // Code stays optional CLIENT-side — the server decides. A grandfathered user replaying
      // onboarding re-syncs with no code and must not be blocked by client validation.
      await authSync('@' + clean, code.trim() || undefined);
      try {
        localStorage.removeItem('fpay:invite');
      } catch {
        /* storage blocked */
      }
      onDone();
    } catch (e) {
      const apiCode = e instanceof ApiError ? e.code : '';
      setGated(GATE_CODES.has(apiCode));
      setErr(
        apiCode === 'invite_required'
          ? 'fpay is invite-only. Ask a friend for one of their codes'
          : // Unknown, already used and revoked all arrive as one code — the server won't say which,
            // so neither can this. "isn't valid" covers all three honestly.
            apiCode === 'invalid_invite'
            ? "That invite code isn't valid"
            : // Everything else through the shared catalog. It used to fall through to e.message,
              // which for an ApiError is the raw server code — signup's last screen showed people
              // the string "handle_taken".
              friendlyError(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.fhead}>
        <BackButton onPress={() => router.back()} />
      </View>

      <View style={styles.center}>
        <Txt style={[type.onbH1, { textAlign: 'center' }]}>Choose your handle</Txt>
        <Txt style={styles.sub}>This is how friends find and pay you on fpay.</Txt>

        <View style={styles.fieldWrap}>
          <View style={[styles.field, avail === false ? { borderColor: colors.danger } : null]}>
            <Txt style={styles.at}>@</Txt>
            <input
              style={sxHandleInput}
              value={clean}
              onChange={(e) => setH(e.target.value)}
              placeholder="yourname"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </View>
          <View style={styles.fieldFoot}>
            <Txt style={[type.note, { color: colors.muted }]}>This can&apos;t be changed later.</Txt>
            {avail ? (
              <View className="fp-arrive" style={styles.availPill}>
                <Icons.Check size={15} color={colors.secondary} fill />
                <Txt style={[type.tierTag, { color: colors.secondary }]}>Available</Txt>
              </View>
            ) : avail === false ? (
              <Txt style={[type.tierTag, { color: colors.danger }]}>Taken</Txt>
            ) : null}
          </View>
          <View style={[styles.field, styles.codeField]}>
            <input
              style={sxCodeInput}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Invite code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </View>
          {err ? <Txt style={[type.note, { color: colors.danger, marginTop: 8 }]}>{err}</Txt> : null}
          {/* This used to read "No invite? Join the f list →" and it was an escape hatch. It isn't
              one any more: the f list is itself invite-only, so that link sent someone with no code
              to a form demanding the code they'd just said they didn't have. There is no way in
              without one, and saying so is kinder than a door that opens onto the same wall. */}
          {gated ? (
            <Txt style={[type.note, { marginTop: 10 }]}>
              fpay is invite-only — you need a code from a fren. They can find theirs on{' '}
              {LANDING_URL.replace(/^https?:\/\//, '')}.
            </Txt>
          ) : null}
        </View>
      </View>

      <View style={styles.cta}>
        <Btn label={busy ? 'Saving…' : 'Continue'} disabled={!avail || busy} pending={busy} onPress={onContinue} />
      </View>
    </Screen>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas, paddingLeft: 24, paddingRight: 24, paddingTop: 8, paddingBottom: 26 },
  fhead: { paddingBottom: 2 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  sub: { ...type.leadInk, textAlign: 'center', maxWidth: 280, marginTop: 10 },
  fieldWrap: { alignSelf: 'stretch', marginTop: 30 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.outlineVariant,
    boxShadow: '0 4px 20px rgba(74,70,67,0.05)',
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  at: { fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 22, color: colors.outline, marginRight: 2 },
  fieldFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingLeft: 4, paddingRight: 4 },
  availPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.secondarySoft,
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 12,
    paddingTop: 5,
    paddingBottom: 5,
  },
  codeField: { marginTop: 12, paddingTop: 12, paddingBottom: 12 },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;

const sxCodeInput: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontWeight: 500,
  fontSize: 16,
  color: colors.ink,
  flex: 1,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  minWidth: 0,
};

const sxHandleInput: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontWeight: 600,
  fontSize: 22,
  color: colors.ink,
  flex: 1,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  minWidth: 0,
};
