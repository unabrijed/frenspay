'use client';

// Choose handle — friends use this to pay you.
// Mock mode: the original static @bridge demo. Privy mode: real input + availability check
// (GET /users/resolve) + /auth/sync (upserts the user + embedded wallet).
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { Icons } from '@/components/icons';
import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { AvailBadge, Field, Spacer } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { Screen } from '@/components/ui/Screen';
import { colors, fonts, type } from '@/lib/theme';
import { USE_PRIVY } from '@/services/env';
import { wallet } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

export default function Handle() {
  const router = useRouter();
  if (USE_PRIVY) return <HandlePrivy onDone={() => router.push('/onboarding/fund')} />;
  return (
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.fhead}>
        <BackButton onPress={() => router.back()} />
      </View>
      <Txt style={type.onbH1}>Choose your handle</Txt>
      <Txt style={[type.lead, { fontSize: 15 }]}>Friends use this to pay you.</Txt>
      <Field style={{ marginTop: 8 }}>
        <Txt style={[type.fieldText, { color: colors.muted }]}>@</Txt>
        <Txt style={type.fieldText}>bridge</Txt>
        <View style={{ flex: 1 }} />
        <AvailBadge>
          <Icons.LockCheck size={16} color={colors.accent} strokeWidth={2} />
        </AvailBadge>
      </Field>
      <Txt style={styles.avail}>@bridge is available</Txt>
      <Spacer />
      <View style={styles.cta}>
        <Btn label="Continue" onPress={() => router.push('/onboarding/fund')} />
      </View>
    </Screen>
  );
}

function HandlePrivy({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const authSync = usePayStore((s) => s.authSync);
  const [h, setH] = useState('');
  const [avail, setAvail] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const clean = h.trim().replace(/^@/, '');

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
    setBusy(true);
    try {
      await authSync('@' + clean);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.fhead}>
        <BackButton onPress={() => router.back()} />
      </View>
      <Txt style={type.onbH1}>Choose your handle</Txt>
      <Txt style={[type.lead, { fontSize: 15 }]}>Friends use this to pay you.</Txt>
      <Field style={{ marginTop: 8 }}>
        <Txt style={[type.fieldText, { color: colors.muted }]}>@</Txt>
        <input
          style={sxHandleInput}
          value={clean}
          onChange={(e) => setH(e.target.value)}
          placeholder="handle"
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
        />
        {avail ? (
          <AvailBadge>
            <Icons.LockCheck size={16} color={colors.accent} strokeWidth={2} />
          </AvailBadge>
        ) : null}
      </Field>
      {avail === false ? (
        <Txt style={[styles.avail, { color: colors.danger }]}>@{clean} is taken</Txt>
      ) : avail ? (
        <Txt style={styles.avail}>@{clean} is available</Txt>
      ) : null}
      {err ? <Txt style={[type.lead, { fontSize: 13, color: colors.danger }]}>{err}</Txt> : null}
      <Spacer />
      <View style={styles.cta}>
        <Btn label={busy ? 'Saving…' : 'Continue'} disabled={!avail || busy} onPress={onContinue} />
      </View>
    </Screen>
  );
}

const styles = {
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 8,
    paddingBottom: 26,
    gap: 13,
  },
  fhead: { paddingBottom: 2 },
  avail: { ...fonts.mono400, fontSize: 14, color: colors.accent, marginTop: 2 },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;

const sxHandleInput: CSSProperties = {
  ...type.fieldText,
  flex: 1,
  paddingTop: 0,
  paddingBottom: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  minWidth: 0,
};
