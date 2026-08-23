// Home — the balance, Add · Send, the lazy verify prompt, recent activity. Port of the web's
// (tabs)/home/page.tsx; the only differences are the router and the ScrollView.
import { Skeleton, TxCard, TxListSkeleton, useBalanceDisplay, usePayStore, VerifyCard } from '@fpay/app';
import type { Txn } from '@fpay/shared';
import { Avatar, colors, Empty, GUTTER, Icons, Pressable, rnStyle, Screen, shadows, Txt, type, View } from '@fpay/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect } from 'react';
import { ScrollView } from 'react-native';

export default function Home() {
  const router = useRouter();
  // Returning from the hosted KYC flow: Persona's redirect lands on fpay://home?inquiry-id=…
  const { 'inquiry-id': inquiryId } = useLocalSearchParams<{ 'inquiry-id'?: string }>();
  const pollKyc = usePayStore((s) => s.pollKyc);
  const kycTier = usePayStore((s) => s.kycTier);
  const kycStatus = usePayStore((s) => s.kycStatus);
  const txns = usePayStore((s) => s.transactions);
  const loaded = usePayStore((s) => s.firstLoadDone);
  const handle = usePayStore((s) => s.handle);
  const open = usePayStore((s) => s.open);
  const openDetail = usePayStore((s) => s.openDetail);
  const unread = usePayStore((s) => s.unread);
  const toggleFlip = usePayStore((s) => s.toggleFlip);
  const hideAmounts = usePayStore((s) => s.hideAmounts);
  const toggleHideAmounts = usePayStore((s) => s.toggleHideAmounts);
  const { symbol, digits, secondary } = useBalanceDisplay();
  const initial = (handle.replace(/^@/, '')[0] ?? 'U').toUpperCase();

  useEffect(() => {
    if (!inquiryId) return;
    void pollKyc();
    router.replace('/home');
  }, [inquiryId, pollKyc, router]);

  const openTx = (tx: Txn) => {
    openDetail(tx);
    router.push('/detail');
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={rnStyle(styles.scroll)}>
        <View style={styles.bar}>
          <Avatar label={initial} onPress={() => router.push('/settings')} />
          <Txt style={type.brandWord}>fpay</Txt>
          <Pressable onPress={() => open('notifications')} style={({ pressed }) => [styles.barBtn, pressed ? { opacity: 0.6 } : null]}>
            <Icons.Bell size={26} color={colors.accent} />
            {unread > 0 ? <View style={styles.badge} /> : null}
          </Pressable>
        </View>

        <View style={styles.hero}>
          {loaded ? (
            <>
              <View style={styles.heroAmt}>
                <Txt style={[type.heroBalance, styles.symbol]}>{symbol}</Txt>
                <Txt style={type.heroBalance}>{digits}</Txt>
                <Pressable onPress={toggleHideAmounts} style={styles.eyeBtn}>
                  {hideAmounts ? <Icons.EyeOff size={22} /> : <Icons.Eye size={22} />}
                </Pressable>
              </View>
              {secondary ? (
                <Pressable onPress={toggleFlip}>
                  <Txt style={styles.secondary}>{secondary}</Txt>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Skeleton w={210} h={52} r={12} />
          )}
        </View>

        <View style={styles.actions}>
          <ActionBtn label="Add" onPress={() => open('add')} icon={<Icons.Plus size={24} color={colors.accent} />} />
          <ActionBtn label="Send" onPress={() => open('send')} icon={<Icons.Send size={24} color={colors.accent} />} />
        </View>

        {loaded && kycTier < 2 ? (
          <View style={styles.verify}>
            <VerifyCard tier={kycTier} status={kycStatus} onPress={() => open('verify')} />
          </View>
        ) : null}

        <View style={styles.recent}>
          <View style={styles.rh}>
            <Txt style={[type.screenTitle, { fontSize: 20 }]}>Recent activity</Txt>
            <Pressable onPress={() => router.push('/activity')}>
              <Txt style={type.seeAll}>See all</Txt>
            </Pressable>
          </View>
          <View style={styles.txList}>
            {!loaded ? (
              <TxListSkeleton rows={3} />
            ) : txns.length === 0 ? (
              <Empty label="No activity yet." />
            ) : (
              txns.slice(0, 4).map((tx) => <TxCard key={tx.id} tx={tx} onPress={() => openTx(tx)} />)
            )}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

function ActionBtn({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed ? { transform: 'scale(0.96)' } : null]}>
      <View style={styles.actionIcon}>{icon}</View>
      <Txt style={[type.tileLabel, { color: colors.ink }]}>{label}</Txt>
    </Pressable>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 4, paddingLeft: 2, paddingRight: 2 },
  barBtn: { position: 'relative', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, right: 6, width: 9, height: 9, borderRadius: 9, backgroundColor: colors.coral, borderWidth: 1.5, borderStyle: 'solid', borderColor: colors.canvas },
  hero: { alignItems: 'center', marginTop: 6, paddingTop: 34, paddingBottom: 34 },
  heroAmt: { flexDirection: 'row', alignItems: 'baseline' },
  eyeBtn: { alignSelf: 'center', marginLeft: 10, padding: 4 },
  symbol: { fontSize: 28, color: colors.tertiary, marginRight: 2 },
  secondary: { ...type.sub, fontSize: 16, marginTop: 10 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginBottom: 4, paddingLeft: 4, paddingRight: 4 },
  action: { alignItems: 'center', gap: 8 },
  actionIcon: { width: 58, height: 58, borderRadius: 999, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  verify: { marginTop: 28, marginBottom: -14 },
  recent: { marginTop: 30 },
  rh: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 2, paddingRight: 2, paddingBottom: 12 },
  txList: { gap: 10 },
} satisfies Record<string, CSSProperties>;
