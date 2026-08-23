// Settings — profile, verify, invites count, account rows, log out. Port of the web's settings/page.tsx.
import { usePayStore, VerifyCard } from '@fpay/app';
import { BackButton, colors, Flag, fonts, GUTTER, Icons, List, Pressable, ProfileAvatar, radii, rnStyle, Row, RowMeta, Screen, Spacer, TextLink, Txt, type, View } from '@fpay/ui';
import { useRouter } from 'expo-router';
import type { CSSProperties, ReactNode } from 'react';
import { Linking, ScrollView } from 'react-native';

import { IS_DEV } from '@/services/envConfig';

export default function Settings() {
  const router = useRouter();
  const open = usePayStore((s) => s.open);
  const handle = usePayStore((s) => s.handle);
  const phone = usePayStore((s) => s.phone);
  const country = usePayStore((s) => s.country);
  const displayCurrency = usePayStore((s) => s.displayCurrency);
  const localCurrency = usePayStore((s) => s.localCurrency);
  const recoveryPasskey = usePayStore((s) => s.recoveryPasskey);
  const kycTier = usePayStore((s) => s.kycTier);
  const kycStatus = usePayStore((s) => s.kycStatus);
  const invitesTotal = usePayStore((s) => s.invitesTotal);
  const invitesUsed = usePayStore((s) => s.invitesUsed);
  const logout = usePayStore((s) => s.logout);
  const resetForTesting = usePayStore((s) => s.resetForTesting);
  return (
    <Screen edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={rnStyle(styles.scroll)}>
        <View style={styles.fhead}>
          <BackButton onPress={() => router.back()} />
        </View>

        <View style={styles.profile}>
          <ProfileAvatar label={(handle.replace(/^@/, '')[0] ?? '').toUpperCase()} />
          <View>
            <Txt style={type.handle}>{handle || '—'}</Txt>
            <Txt style={[type.profileSub, { marginTop: 2 }]}>fpay account</Txt>
          </View>
        </View>

        <VerifyCard tier={kycTier} status={kycStatus} onPress={() => open('verify')} />

        <InviteCard used={invitesUsed} total={invitesTotal} />

        <List>
          <SettingsRow k="Recovery" v={recoveryPasskey ? 'Passkey set' : 'Email'} onPress={() => open('recovery')} />
          <SettingsRow k="Pay by phone" v={phone ? 'On' : 'Off'} onPress={() => open('payByPhone')} />
          <SettingsRow
            k="Country"
            v={country || 'Not set'}
            icon={country ? <Flag iso={country} size={20} /> : null}
            onPress={kycTier >= 2 && country ? undefined : () => open('country')}
          />
          <SettingsRow k="Display currency" v={displayCurrency} accent onPress={() => open('currency')} />
          <SettingsRow k="Local currency" v={localCurrency ?? 'Auto'} accent onPress={() => open('localCurrency')} />
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
          {/* Requested credit for the free FX endpoint we quote from (exchangerate-api.com/docs/free). */}
          <Pressable onPress={() => void Linking.openURL('https://www.exchangerate-api.com')}>
            <Txt style={type.version}>Rates By Exchange Rate API</Txt>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

function SettingsRow({ k, v, icon, accent, onPress }: { k: string; v?: string; icon?: ReactNode; accent?: boolean; onPress?: () => void }) {
  return (
    <Row onPress={onPress}>
      <RowMeta>
        <Txt style={type.rowName}>{k}</Txt>
      </RowMeta>
      <View style={styles.value}>
        {icon}
        {v ? <Txt style={{ ...fonts.mono400, fontSize: 15, color: accent ? colors.accent : colors.muted }}>{v}</Txt> : null}
        {onPress ? <Icons.Chevron size={16} color={colors.muted} /> : null}
      </View>
    </Row>
  );
}

function InviteCard({ used, total }: { used: number; total: number }) {
  const left = Math.max(0, total - used);
  return (
    <View style={styles.kyc}>
      <View style={styles.kycHead}>
        <View style={{ flex: 1 }}>
          <Txt style={type.rowName}>Your invites</Txt>
          <Txt style={[type.rowTime, { marginTop: 2 }]}>
            {total === 0 ? 'No invites yet' : left > 0 ? `${left} of ${total} still to give` : `All ${total} used — that's your circle`}
          </Txt>
        </View>
      </View>
    </View>
  );
}

const styles = {
  kyc: { borderWidth: 1, borderStyle: 'solid', borderColor: colors.hair, borderRadius: radii.card, padding: 16, backgroundColor: colors.surface, marginBottom: 14 },
  kycHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1, paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  fhead: { paddingTop: 8, paddingBottom: 6, paddingLeft: 2, paddingRight: 2 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingLeft: 2, paddingRight: 2, paddingTop: 10, paddingBottom: 18 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { alignItems: 'center', gap: 10, paddingBottom: 20 },
} satisfies Record<string, CSSProperties>;
