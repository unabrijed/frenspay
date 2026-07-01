'use client';

// Settings — profile, account rows, replay onboarding. Per screens-more.jsx.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';

import { Icons } from '@/components/icons';
import { BackButton } from '@/components/ui/BackButton';
import { TextLink } from '@/components/ui/Button';
import { List, ProfileAvatar, Row, RowMeta, Spacer } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { colors, fonts, GUTTER, type } from '@/lib/theme';
import { IS_DEV } from '@/services/env';
import { usePayStore } from '@/store/usePayStore';

export default function Settings() {
  const router = useRouter();
  const open = usePayStore((s) => s.open);
  const handle = usePayStore((s) => s.handle);
  const displayCurrency = usePayStore((s) => s.displayCurrency);
  const recoveryPasskey = usePayStore((s) => s.recoveryPasskey);
  const kycTier = usePayStore((s) => s.kycTier);
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

        <List>
          <SettingsRow k="Verification" v={`Tier ${kycTier}`} onPress={() => open('verify')} />
          <SettingsRow k="Recovery" v={recoveryPasskey ? 'Passkey set' : 'Email'} onPress={() => open('recovery')} />
          <SettingsRow k="Display currency" v={displayCurrency} accent onPress={() => open('currency')} />
          <SettingsRow k="Help and support" onPress={() => open('help')} />
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

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1, paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  fhead: { paddingTop: 8, paddingBottom: 6, paddingLeft: 2, paddingRight: 2 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingLeft: 2, paddingRight: 2, paddingTop: 10, paddingBottom: 18 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { alignItems: 'center', gap: 10, paddingBottom: 20 },
} satisfies Record<string, CSSProperties>;
