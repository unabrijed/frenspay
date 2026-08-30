'use client';

// The verification surface, shared by Settings and Home. Tier < 2 shows a "Verify identity" CTA →
// open('verify') (the existing Persona/sim flow); tier ≥ 2 shows the verified state.
//
// It lives here rather than in settings/page.tsx because verification is not a settings chore:
// nobody goes looking in Settings for a thing they don't know they need. Home renders the unverified
// half of this so the prompt is where the user already is. Verification stays LAZY either way — no
// onboarding step, no gate on Home; the send flow's own tier check (payPayee → open('verify')) is
// still the moment it becomes mandatory.
import type { CSSProperties } from 'react';

import { type KycStatus } from '@fpay/shared';

import { Btn, colors, Icons, Pressable, radii, Txt, type, View } from '@fpay/ui';

export function VerifyCard({
  tier,
  status,
  available = true,
  onPress,
}: {
  tier: number;
  status?: KycStatus;
  /** False when the identity vendor is switched off for this deployment (/me.identityCheckAvailable).
   *  There is no check to start, so the card stops asking: a CTA that can only fail, on Home, for
   *  weeks, is worse than saying plainly that checks are paused. */
  available?: boolean;
  onPress: () => void;
}) {
  const verified = tier >= 2;
  const paused = !verified && !available;
  // A check already running must not be advertised as one that hasn't started — the sheet behind this
  // card says "Checking your result…", and an unqualified "Verify identity" out here contradicted it.
  const waiting = !verified && available && (status === 'pending' || status === 'in_review');
  const head = (
    <View style={styles.kycHead}>
      {verified ? (
        <View style={styles.badgeOk}>
          <Icons.LockCheck size={16} color={colors.white} strokeWidth={2.2} />
        </View>
      ) : (
        <View style={styles.badgeOff} />
      )}
      <View style={{ flex: 1 }}>
        <Txt style={type.rowName}>
          {verified ? 'Identity verified' : waiting ? 'Verification in progress' : paused ? 'Identity checks are paused' : 'Verify your identity'}
        </Txt>
        <Txt style={[type.rowTime, { marginTop: 2 }]}>
          {verified
            ? `Tier ${tier} · scan-to-pay and higher limits`
            : waiting
              ? 'We’re waiting on the result'
              : paused
                ? 'We’ll let you know as soon as they’re back on'
                : 'Unlock scan-to-pay and higher limits'}
        </Txt>
      </View>
      {verified ? <Icons.Chevron size={16} color={colors.muted} /> : null}
    </View>
  );
  if (verified) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.kyc, styles.kycOn, pressed ? { opacity: 0.9 } : null]}>
        {head}
      </Pressable>
    );
  }
  // Paused: the head says it, and there is nothing to press. Offering a button here would 503.
  if (paused) return <View style={styles.kyc}>{head}</View>;
  return (
    <View style={styles.kyc}>
      {head}
      <Btn
        label={waiting ? 'See progress' : 'Verify identity'}
        variant={waiting ? 'secondary' : 'primary'}
        onPress={onPress}
        style={{ marginTop: 14 }}
      />
    </View>
  );
}

const styles = {
  kyc: { borderWidth: 1, borderStyle: 'solid', borderColor: colors.hair, borderRadius: radii.card, padding: 16, backgroundColor: colors.surface, marginBottom: 14 },
  kycOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  kycHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badgeOk: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeOff: { width: 40, height: 40, borderRadius: 999, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.muted },
} satisfies Record<string, CSSProperties>;
