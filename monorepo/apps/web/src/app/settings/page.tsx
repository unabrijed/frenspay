'use client';

// Settings — profile, account rows, replay onboarding. Per screens-more.jsx.
import { useRouter } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';


import { Icons } from '@/components/icons';
import { BackButton } from '@/components/ui/BackButton';
import { Btn, TextLink } from '@/components/ui/Button';
import { Flag, List, ProfileAvatar, Row, RowMeta, Spacer } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { VerifyCard } from '@/components/VerifyCard';
import { colors, fonts, GUTTER, radii, type } from '@/lib/theme';
import { IS_LOCAL_ENV } from '@/services/envConfig';
import { usePayStore } from '@/store/usePayStore';

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
  const identityCheckAvailable = usePayStore((s) => s.identityCheckAvailable);
  const invitesTotal = usePayStore((s) => s.invitesTotal);
  const invitesUsed = usePayStore((s) => s.invitesUsed);
  const logout = usePayStore((s) => s.logout);
  const resetForTesting = usePayStore((s) => s.resetForTesting);
  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.scroll}>
        <View style={styles.fhead}>
          <BackButton onPress={() => router.back()} />
        </View>

        <View style={styles.profile}>
          {/* Never invent an identity. This used to read '@you' over a 'U' monogram and the caption
              "fpay account" — and '@you' is a VALID handle shape, so it looked like a real account
              someone had been given rather than a placeholder. It shows whenever the store's own
              handle is empty, which includes the frame right after Log out clears it below (this
              screen is still mounted) and the /me window on a cold sign-in. The dash is what the
              Receive sheet already shows for the same unknown. */}
          <ProfileAvatar label={(handle.replace(/^@/, '')[0] ?? '').toUpperCase()} />
          <View>
            <Txt style={type.handle}>{handle || '—'}</Txt>
            <Txt style={[type.profileSub, { marginTop: 2 }]}>fpay account</Txt>
          </View>
        </View>

        <VerifyCard tier={kycTier} status={kycStatus} available={identityCheckAvailable} onPress={() => open('verify')} />

        <InviteCard used={invitesUsed} total={invitesTotal} />

        <List>
          <SettingsRow k="Recovery" v={recoveryPasskey ? 'Passkey set' : 'Email'} onPress={() => open('recovery')} />
          <SettingsRow k="Pay by phone" v={phone ? 'On' : 'Off'} onPress={() => open('payByPhone')} />
          {/* Verified users' country comes from their KYC document — read-only, no picker. */}
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
          {/* IS_LOCAL_ENV, not IS_DEV: the backing route (POST /sim/kyc/1) is gated on isLocal, because
              isDevelopment includes stage and stage is mainnet. On a stage build IS_DEV is true, so this
              link used to render and now 403s — logging you out without resetting the tier it promises. */}
          {IS_LOCAL_ENV ? (
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
          <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <Txt style={type.version}>Rates By Exchange Rate API</Txt>
          </a>
        </View>
      </View>
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
        {v ? (
          <Txt style={{ ...fonts.mono400, fontSize: 15, color: accent ? colors.accent : colors.muted }}>{v}</Txt>
        ) : null}
        {onPress ? <Icons.Chevron size={16} color={colors.muted} /> : null}
      </View>
    </Row>
  );
}

// Invite status — COUNTS ONLY, deliberately. The codes were shown once at signup and are gone from
// the app forever; re-listing them here would quietly undo that ("lose it, lose a fren"), so there
// is no share button and nothing to copy. What's left is the one thing still worth knowing: how
// many frens you have left to bring.
function InviteCard({ used, total }: { used: number; total: number }) {
  const left = Math.max(0, total - used);
  return (
    <View style={styles.kyc}>
      <View style={styles.kycHead}>
        <View style={{ flex: 1 }}>
          <Txt style={type.rowName}>Your invites</Txt>
          <Txt style={[type.rowTime, { marginTop: 2 }]}>
            {total === 0
              ? 'No invites yet'
              : left > 0
                ? `${left} of ${total} still to give`
                : `All ${total} used — that's your circle`}
          </Txt>
        </View>
      </View>
    </View>
  );
}

const styles = {
  // Shared shape with VerifyCard (which owns its own copy) — InviteCard is the only user left here.
  kyc: { borderWidth: 1, borderStyle: 'solid', borderColor: colors.hair, borderRadius: radii.card, padding: 16, backgroundColor: colors.surface, marginBottom: 14 },
  kycHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1, overflowY: 'auto', paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  fhead: { paddingTop: 8, paddingBottom: 6, paddingLeft: 2, paddingRight: 2 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingLeft: 2, paddingRight: 2, paddingTop: 10, paddingBottom: 18 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { alignItems: 'center', gap: 10, paddingBottom: 20 },
} satisfies Record<string, CSSProperties>;
