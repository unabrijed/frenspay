// Settings — profile, account rows, replay onboarding. Per screens-more.jsx.
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icons } from '@/components/icons';
import { BackButton } from '@/components/ui/BackButton';
import { TextLink } from '@/components/ui/Button';
import { List, ProfileAvatar, Row, RowMeta, Spacer } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { colors, fonts, GUTTER, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

export default function Settings() {
  const router = useRouter();
  const open = usePayStore((s) => s.open);
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.scroll}>
        <View style={styles.fhead}>
          <BackButton onPress={() => router.back()} />
        </View>

        <View style={styles.profile}>
          <ProfileAvatar label="B" />
          <View>
            <Txt style={type.handle}>@bridge</Txt>
            <Txt style={[type.profileSub, { marginTop: 2 }]}>Bridge</Txt>
          </View>
        </View>

        <List>
          <SettingsRow k="Verification" v="Tier 1" onPress={() => open('verify')} />
          <SettingsRow k="Recovery" v="Email set" onPress={() => open('recovery')} />
          <SettingsRow k="Display currency" v="INR" accent />
          <SettingsRow k="Help and support" />
        </List>

        <Spacer />
        <View style={styles.footer}>
          <TextLink label="Replay onboarding" onPress={() => router.push('/onboarding/welcome')} />
          <TextLink label="Log out" />
          <Txt style={type.version}>v0.1</Txt>
        </View>
      </View>
    </SafeAreaView>
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
          <Txt style={{ fontFamily: fonts.mono400, fontSize: 15, color: accent ? colors.accent : colors.muted }}>{v}</Txt>
        ) : null}
        <Icons.Chevron size={16} color={colors.muted} />
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1, paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 24 },
  fhead: { paddingTop: 8, paddingBottom: 6, paddingHorizontal: 2 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 2, paddingTop: 10, paddingBottom: 18 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { alignItems: 'center', gap: 10, paddingBottom: 20 },
});
