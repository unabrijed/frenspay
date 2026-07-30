'use client';

// Settings — profile, account rows, replay onboarding. Per screens-more.jsx.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';

import { Icons } from '@/components/icons';
import { BackButton } from '@/components/ui/BackButton';
import { Btn, TextLink } from '@/components/ui/Button';
import { List, ProfileAvatar, Row, RowMeta, Spacer } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { colors, fonts, GUTTER, radii, type } from '@/lib/theme';
import { IS_DEV } from '@/services/env';
import { usePayStore } from '@/store/usePayStore';

export default function Settings() {
  const router = useRouter();
  const open = usePayStore((s) => s.open);
  const handle = usePayStore((s) => s.handle);
  const phone = usePayStore((s) => s.phone);
  const country = usePayStore((s) => s.country);
  const displayCurrency = usePayStore((s) => s.displayCurrency);
  const recoveryPasskey = usePayStore((s) => s.recoveryPasskey);
  const kycTier = usePayStore((s) => s.kycTier);
  const merchant = usePayStore((s) => s.merchant);
  const role = usePayStore((s) => s.role);
  const logout = usePayStore((s) => s.logout);
  const resetForTesting = usePayStore((s) => s.resetForTesting);
  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.scroll}>
        <View style={styles.fhead}>
          <BackButton onPress={() => router.back()} />
        </View>

        <View style={styles.profile}>
          <ProfileAvatar label={(handle.replace(/^@/, '')[0] ?? 'U').toUpperCase()} />
          <View>
            <Txt style={type.handle}>{handle || '@you'}</Txt>
            <Txt style={[type.profileSub, { marginTop: 2 }]}>fpay account</Txt>
          </View>
        </View>

        <VerifyCard tier={kycTier} onPress={() => open('verify')} />

        <List>
          <SettingsRow k="Recovery" v={recoveryPasskey ? 'Passkey set' : 'Email'} onPress={() => open('recovery')} />
          <SettingsRow k="Pay by phone" v={phone ? 'On' : 'Off'} onPress={() => open('payByPhone')} />
          <SettingsRow k="Country" v={country || 'Not set'} onPress={() => open('country')} />
          <SettingsRow k="Display currency" v={displayCurrency} accent onPress={() => open('currency')} />
          <SettingsRow k="Help and support" onPress={() => open('help')} />
          {/* Only surfaced once they run a merchant account — an ordinary payer never sees it. */}
          {merchant ? (
            <SettingsRow
              k="Merchant"
              v={merchant.kybStatus === 'approved' ? merchant.status : merchant.kybStatus}
              accent
              onPress={() => router.push('/merchant')}
            />
          ) : null}
          {/* Operator-only: the read-only flow viewer. The backend 403s non-admins anyway. */}
          {role === 'admin' ? <SettingsRow k="Admin" accent onPress={() => router.push('/admin')} /> : null}
        </List>

        <Spacer />
        <View style={styles.footer}>
          <TextLink label="Replay onboarding" onPress={() => router.push('/onboarding/welcome')} />
          <TextLink
            label="Log out"
            onPress={async () => {
              await logout();
              router.replace('/onboarding/welcome');
            }}
          />
          {IS_DEV ? (
            <TextLink
              label="Reset for testing"
              onPress={async () => {
                await resetForTesting();
                router.replace('/onboarding/welcome');
              }}
            />
          ) : null}
          <Txt style={type.version}>v0.1</Txt>
        </View>
      </View>
    </Screen>
  );
}

function SettingsRow({ k, v, accent, onPress }: { k: string; v?: string; accent?: boolean; onPress?: () => void }) {
  return (
    <Row onPress={onPress}>
      <RowMeta>
        <Txt style={type.rowName}>{k}</Txt>
      </RowMeta>
      <View style={styles.value}>
        {v ? (
          <Txt style={{ ...fonts.mono400, fontSize: 15, color: accent ? colors.accent : colors.muted }}>{v}</Txt>
        ) : null}
        <Icons.Chevron size={16} color={colors.muted} />
      </View>
    </Row>
  );
}

// Prominent verification/activation surface (promoted from a plain settings row). Tier < 2 shows a
// "Verify identity" CTA → open('verify') (the existing Didit/sim flow); Tier ≥ 2 shows the verified state.
function VerifyCard({ tier, onPress }: { tier: number; onPress: () => void }) {
  const verified = tier >= 2;
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
        <Txt style={type.rowName}>{verified ? 'Identity verified' : 'Verify your identity'}</Txt>
        <Txt style={[type.rowTime, { marginTop: 2 }]}>
          {verified ? `Tier ${tier} · merchant payments unlocked` : 'Unlock merchant payments and higher limits'}
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
  return (
    <View style={styles.kyc}>
      {head}
      <Btn label="Verify identity" onPress={onPress} style={{ marginTop: 14 }} />
    </View>
  );
}

const styles = {
  kyc: { borderWidth: 1, borderStyle: 'solid', borderColor: colors.hair, borderRadius: radii.card, padding: 16, backgroundColor: colors.surface, marginBottom: 14 },
  kycOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  kycHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badgeOk: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeOff: { width: 40, height: 40, borderRadius: 999, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.muted },
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1, paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  fhead: { paddingTop: 8, paddingBottom: 6, paddingLeft: 2, paddingRight: 2 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingLeft: 2, paddingRight: 2, paddingTop: 10, paddingBottom: 18 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { alignItems: 'center', gap: 10, paddingBottom: 20 },
} satisfies Record<string, CSSProperties>;
