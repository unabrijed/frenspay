// The one look: three codes, shown once. Port of the web's invites/page.tsx; share/copy through the
// platform seam.
import { platform, usePayStore, useStoreHydrated } from '@fpay/app';
import { Btn, colors, fonts, Mark, rnStyle, Screen, Txt, type, View } from '@fpay/ui';
import { useRouter } from 'expo-router';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';

import { Splash } from '@/components/Splash';
import { LANDING_URL } from '@/services/envConfig';

export default function Invites() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const invites = usePayStore((s) => s.invites);
  const acknowledgeInvites = usePayStore((s) => s.acknowledgeInvites);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hydrated && invites.length === 0 && !busy) router.replace('/home');
  }, [hydrated, invites.length, busy, router]);

  const done = async () => {
    setBusy(true);
    try {
      await acknowledgeInvites();
    } catch {
      /* a failed ack re-reveals on the next cold boot — annoying, not harmful */
    }
    router.replace('/home');
  };

  if (!hydrated || invites.length === 0) return <Splash />;

  return (
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <ScrollView contentContainerStyle={rnStyle(styles.scroll)}>
        <Txt style={[type.onbH1, { textAlign: 'center' }]}>
          {invites.length === 1 ? 'One fren.' : `${invites.length} frens.`} That&apos;s it.
        </Txt>
        <Txt style={styles.sub}>
          Give these to the people you actually want here. You won&apos;t see this screen again, so save
          them somewhere.
        </Txt>
        <View style={styles.cards}>
          {invites.map((code) => (
            <InviteCard key={code} code={code} />
          ))}
        </View>
      </ScrollView>
      <View style={styles.cta}>
        <Btn label={busy ? 'Saving…' : "I've saved them"} disabled={busy} pending={busy} onPress={done} />
      </View>
    </Screen>
  );
}

function InviteCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const text = `You're invited to fpay.\nYour code: ${code}`;
  const url = LANDING_URL;

  const onCopy = async () => {
    try {
      await platform().copy(`${text}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the code is on screen to read */
    }
  };
  const onShare = async () => {
    try {
      await platform().share({ title: 'Join fpay', text, url });
    } catch {
      /* dismissed the sheet */
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Mark size={20} color={colors.accent} bead={colors.surface} />
        <Txt style={styles.brand}>fpay</Txt>
      </View>
      <Txt style={styles.code}>{code}</Txt>
      <View style={styles.actions}>
        <Btn label="Share" variant="secondary" onPress={onShare} style={{ flex: 1 }} />
        <Btn label={copied ? 'Copied' : 'Copy'} variant="secondary" onPress={onCopy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas, paddingLeft: 24, paddingRight: 24, paddingTop: 8, paddingBottom: 26 },
  scroll: { paddingTop: 28, paddingBottom: 16 },
  sub: { ...type.leadInk, textAlign: 'center', maxWidth: 320, alignSelf: 'center', marginTop: 10 },
  cards: { alignSelf: 'stretch', marginTop: 26, gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderStyle: 'solid', borderColor: colors.outlineVariant, padding: 16 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brand: { ...fonts.body600, fontSize: 13, color: colors.accent, letterSpacing: 0.2 },
  code: { ...fonts.mono600, fontSize: 25, letterSpacing: 1.4, color: colors.ink, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cta: { gap: 13, alignItems: 'center', paddingTop: 8 },
} satisfies Record<string, CSSProperties>;
