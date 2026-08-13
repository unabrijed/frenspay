'use client';

// The one look. Three codes, shown once, then gone from the app forever — /me stops returning the
// strings the moment this screen is acknowledged, so there is no "show them again" to build. Losing
// one loses a fren, which is the whole point: an invite is scarce or it isn't an invite.
//
// Reached from the tabs layout guard rather than from a step in the onboarding chain, because the
// codes can appear on several paths — a new signup finishing funding, the mainnet fund-skip, or an
// account that predates invite codes getting minted three on its next /me. One entrance, one guard.
// Hence /invites and not /onboarding/invites: the route used to sit in the onboarding namespace,
// which made a screen that is explicitly NOT a step look like one.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { Btn } from '@/components/ui/Button';
import { Mark } from '@/components/ui/primitives';
import { Screen } from '@/components/ui/Screen';
import { Splash } from '@/components/ui/Splash';
import { Txt } from '@/components/ui/Txt';
import { View } from '@/components/ui/rn';
import { colors, fonts, type } from '@/lib/theme';
import { LANDING_URL } from '@/services/envConfig';
import { usePayStore, useStoreHydrated } from '@/store/usePayStore';

export default function Invites() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const invites = usePayStore((s) => s.invites);
  const acknowledgeInvites = usePayStore((s) => s.acknowledgeInvites);
  const [busy, setBusy] = useState(false);

  // Nothing to reveal → this screen has already done its job (or was reached by typing the URL).
  // Not an error state: there is genuinely nothing to show, ever again.
  useEffect(() => {
    if (hydrated && invites.length === 0 && !busy) router.replace('/home');
  }, [hydrated, invites.length, busy, router]);

  const done = async () => {
    setBusy(true);
    try {
      await acknowledgeInvites();
    } catch {
      // A failed ack means the server still thinks they're unrevealed, so they'd be shown again on
      // the next load. Annoying, not harmful — and far better than swallowing the codes on a
      // network blip. Go to Home either way.
    }
    router.replace('/home');
  };

  if (!hydrated || invites.length === 0) return <Splash />;

  return (
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.scroll}>
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
      </View>

      <View style={styles.cta}>
        <Btn label={busy ? 'Saving…' : "I've saved them"} disabled={busy} pending={busy} onPress={done} />
      </View>
    </Screen>
  );
}

function InviteCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  // The link goes to the MARKETING site, not this app: a fren who isn't sold yet lands somewhere
  // that explains what fpay is, and that page is where the code gets checked anyway.
  const text = `You're invited to fpay.\nYour code: ${code}`;
  const url = LANDING_URL;

  const flash = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(`${text}\n${url}`);
      flash();
    } catch {
      /* clipboard blocked — the code is on screen to read */
    }
  };

  const onShare = async () => {
    // No share sheet (desktop, mostly) → copying IS the share. Silently doing nothing would read as
    // a broken button.
    if (!navigator.share) return onCopy();
    try {
      await navigator.share({ title: 'Join fpay', text, url });
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
  scroll: { flex: 1, overflowY: 'auto', paddingTop: 28, paddingBottom: 16 },
  sub: { ...type.leadInk, textAlign: 'center', maxWidth: 320, alignSelf: 'center', marginTop: 10 },
  cards: { alignSelf: 'stretch', marginTop: 26, gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.outlineVariant,
    boxShadow: '0 4px 20px rgba(74,70,67,0.05)',
    padding: 16,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brand: { fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 13, color: colors.accent, letterSpacing: 0.2 },
  // mono600 is the tabular-figures cut of Hanken Grotesk — the same role money and handles use, so
  // digits sit on a fixed advance and the two groups line up. Wide tracking on top of it is what
  // makes this read as something to transcribe rather than a word.
  code: { ...fonts.mono600, fontSize: 25, letterSpacing: 1.4, color: colors.ink, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
