// Choose handle — availability check (GET /users/resolve) + /auth/sync. Port of the web's
// onboarding/handle/page.tsx (adopt-first probe included — see its header); the invite stash is the
// platform's storage instead of localStorage.
import { ApiError, ERROR_COPY, friendlyError, platform, usePayStore, useStoreHydrated, wallet } from '@fpay/app';
import { draftHandle } from '@fpay/shared';
import { BackButton, Btn, colors, fonts, Icons, Input, Screen, shadows, Txt, type, View } from '@fpay/ui';
import { useRouter } from 'expo-router';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { Splash } from '@/components/Splash';
import { LANDING_URL } from '@/services/envConfig';

const GATE_CODES = new Set(['invite_required', 'invalid_invite']);

export default function Handle() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const authStatus = usePayStore((s) => s.authStatus);
  const walletAddress = usePayStore((s) => s.walletAddress);
  const authError = usePayStore((s) => s.authError);
  const completeOnboarding = usePayStore((s) => s.completeOnboarding);
  const load = usePayStore((s) => s.load);

  useEffect(() => {
    if (hydrated && authStatus !== 'signedIn') router.replace('/');
  }, [hydrated, authStatus, router]);
  if (!hydrated || authStatus !== 'signedIn') return <Splash />;
  // /auth/sync needs the embedded wallet — the one screen that waits for it (see the web port).
  if (!walletAddress) {
    if (!authError) return <Splash />;
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Txt style={[type.note, { color: colors.danger, textAlign: 'center' }]}>
            {ERROR_COPY[authError] ?? authError} Close and reopen the app.
          </Txt>
        </View>
      </Screen>
    );
  }

  return (
    <HandlePrivy
      onDone={() => {
        // Onboarding is over here: the funding step that used to follow was the devnet faucet.
        completeOnboarding();
        void load(); // best-effort prefetch; Home skeletons until it or the 12s LiveSync lands
        router.replace('/home');
      }}
    />
  );
}

function HandlePrivy({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const authSync = usePayStore((s) => s.authSync);
  const [h, setH] = useState('');
  const [code, setCode] = useState('');
  const [avail, setAvail] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [gated, setGated] = useState(false);
  const [probing, setProbing] = useState(true);
  const clean = draftHandle(h);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await authSync(undefined);
        if (live) onDone();
      } catch (e) {
        if (!live) return;
        if (!(e instanceof ApiError && e.code === 'handle_required')) setErr(friendlyError(e));
        setProbing(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void Promise.resolve(platform().storage.getItem('fpay:invite')).then((stashed) => {
      if (stashed) setCode(stashed);
    });
  }, []);

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
      await authSync('@' + clean, code.trim() || undefined);
      await platform().storage.removeItem('fpay:invite');
      onDone();
    } catch (e) {
      const apiCode = e instanceof ApiError ? e.code : '';
      setGated(GATE_CODES.has(apiCode));
      setErr(
        apiCode === 'invite_required'
          ? 'fpay is invite-only. Ask a friend for one of their codes'
          : apiCode === 'invalid_invite'
            ? "That invite code isn't valid"
            : friendlyError(e),
      );
    } finally {
      setBusy(false);
    }
  };

  if (probing) return <Splash />;

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
            <Input value={clean} onChangeText={setH} placeholder="yourname" maxLength={30} autoFocus style={styles.handleInput} />
          </View>
          <View style={styles.fieldFoot}>
            <Txt style={[type.note, { color: colors.muted }]}>This can&apos;t be changed later.</Txt>
            {avail ? (
              <View style={styles.availPill}>
                <Icons.Check size={15} color={colors.secondary} fill />
                <Txt style={[type.tierTag, { color: colors.secondary }]}>Available</Txt>
              </View>
            ) : avail === false ? (
              <Txt style={[type.tierTag, { color: colors.danger }]}>Taken</Txt>
            ) : null}
          </View>
          <View style={[styles.field, styles.codeField]}>
            <Input value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="Invite code" style={styles.codeInput} />
          </View>
          {err ? <Txt style={[type.note, { color: colors.danger, marginTop: 8 }]}>{err}</Txt> : null}
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
  field: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderStyle: 'solid', borderColor: colors.outlineVariant, ...shadows.card, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16 },
  at: { ...fonts.body600, fontSize: 22, color: colors.outline, marginRight: 2 },
  handleInput: { ...fonts.body600, fontSize: 22, color: colors.ink, flex: 1, minWidth: 0 },
  codeInput: { ...fonts.body500, fontSize: 16, color: colors.ink, flex: 1, minWidth: 0 },
  fieldFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingLeft: 4, paddingRight: 4 },
  availPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.secondarySoft, borderRadius: 999, paddingLeft: 10, paddingRight: 12, paddingTop: 5, paddingBottom: 5 },
  codeField: { marginTop: 12, paddingTop: 12, paddingBottom: 12 },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
