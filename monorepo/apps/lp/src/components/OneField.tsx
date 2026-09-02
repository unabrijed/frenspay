'use client';

// OneField — a small route with one question: header, one line, a field, a button. The settings that
// used to be window.prompt calls on the dashboard each mount this with their own validate + submit,
// and land back on Account when saved. Minimal by design: a heading, at most one sentence, the control.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { BackButton } from '@fpay/ui/BackButton';
import { Btn } from '@fpay/ui/Button';
import { SearchBar, Spacer } from '@fpay/ui/primitives';
import { ScrollView, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { colors, GUTTER, type } from '@fpay/ui/theme';
import { useLpStore } from '@/store/useLpStore';

export function OneField({
  title,
  hint,
  placeholder,
  initial,
  validate,
  submit,
  label = 'Save',
  done = 'Saved.',
  back = '/account',
  variant = 'ink',
}: {
  title: string;
  hint?: string;
  placeholder: string;
  initial: string;
  /** A message when the value is not acceptable, or null. Runs before the server does. */
  validate: (v: string) => string | null;
  submit: (v: string) => Promise<unknown>;
  label?: string;
  done?: string;
  back?: string;
  variant?: 'ink' | 'primary';
}) {
  const router = useRouter();
  const load = useLpStore((s) => s.load);
  const notify = useLpStore((s) => s.notify);
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    const bad = validate(v);
    if (bad) return setErr(bad);
    setBusy(true);
    setErr(null);
    try {
      await submit(v);
      // The profile is the truth (several of these are recomputed server-side); re-read it, then leave.
      await load();
      notify(done, 'success');
      router.push(back);
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push(back)} />
      </View>
      <ScrollView style={styles.scroll}>
        <Txt style={type.handle}>{title}</Txt>
        {hint ? <Txt style={[type.lead, { marginTop: 8 }]}>{hint}</Txt> : null}
        <View style={{ marginTop: 18 }}>
          <SearchBar
            placeholder={placeholder}
            value={v}
            onChangeText={(t: string) => {
              setV(t);
              setErr(null);
            }}
          />
        </View>
        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 10 }]}>{err}</Txt> : null}
        <Spacer />
        <Btn label={busy ? 'Saving…' : label} variant={variant} disabled={busy} onPress={() => void go()} />
      </ScrollView>
    </Screen>
  );
}

/** A refund destination typed by the partner: blank or their own fpay wallet means "my fpay wallet". */
export const payoutAddressOrNull = (raw: string, wallet?: string): string | null => {
  const a = raw.trim();
  return a && a !== wallet ? a : null;
};

export const styles = {
  safe: { backgroundColor: colors.canvas },
  head: { paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 6, paddingBottom: 2 },
  scroll: { paddingLeft: GUTTER, paddingRight: GUTTER, paddingBottom: 28 },
} satisfies Record<string, CSSProperties>;
