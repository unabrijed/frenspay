'use client';

// Home — fpay dashboard: top app bar, the balance, four Google-Pay-style action buttons
// (Scan / Send / Request / Add), and recent activity as individual tactile cards.
//
// The balance is written ONCE. It used to appear three times on this screen — the hero, a "US
// Dollars" card, and an "INR" card that (since the display currency defaulted to INR) restated the
// hero's exact figure directly beneath it. What replaced all three is one number in the currency
// they chose, plus their own local currency underneath when that is a different currency. No
// label: a figure that size on this screen is not mistakable for anything but the balance.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { Icons } from '@/components/icons';
import { TxCard } from '@/components/TxCard';
import { Avatar, Empty } from '@/components/ui/primitives';
import { Skeleton, TxListSkeleton } from '@/components/ui/Skeleton';
import { Pressable, View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { useBalanceDisplay } from '@/hooks/useBalanceDisplay';
import { colors, GUTTER, shadows, type } from '@/lib/theme';
import type { Txn } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

export default function Home() {
  const router = useRouter();
  const pollKyc = usePayStore((s) => s.pollKyc);
  const txns = usePayStore((s) => s.transactions);
  const loaded = usePayStore((s) => s.firstLoadDone);
  const handle = usePayStore((s) => s.handle);
  const open = usePayStore((s) => s.open);
  const openDetail = usePayStore((s) => s.openDetail);
  const unread = usePayStore((s) => s.unread);
  const { symbol, digits, secondary } = useBalanceDisplay();
  const initial = (handle.replace(/^@/, '')[0] ?? 'U').toUpperCase();

  // Returning from the hosted KYC flow: Didit redirects to the callback (/home) with
  // ?verificationSessionId=…&status=… appended. Poll until the tier lands, then drop the query so a
  // refresh doesn't re-trigger it. Read from window (client-only effect) to avoid useSearchParams'
  // Suspense-boundary requirement at build time. (`kyc=done` kept as a harmless legacy fallback.)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.get('verificationSessionId') && q.get('kyc') !== 'done') return;
    void pollKyc();
    router.replace('/home');
  }, [pollKyc, router]);

  const openTx = (tx: Txn) => {
    openDetail(tx);
    router.push('/detail');
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={[styles.scroll, { overflowY: 'auto' }]}>
        {/* top app bar */}
        <View style={styles.bar}>
          <Avatar label={initial} onPress={() => router.push('/settings')} />
          <Txt style={type.brandWord}>fpay</Txt>
          <Pressable onPress={() => open('notifications')} style={({ pressed }) => [styles.barBtn, pressed ? { opacity: 0.6 } : null]}>
            <Icons.Bell size={26} color={colors.accent} />
            {unread > 0 ? <View style={styles.badge} /> : null}
          </Pressable>
        </View>

        {/* the balance */}
        <View style={styles.hero}>
          {loaded ? (
            <>
              <View className="fp-arrive" style={styles.heroAmt}>
                <Txt style={[type.heroBalance, styles.symbol]}>{symbol}</Txt>
                <Txt style={type.heroBalance}>{digits}</Txt>
              </View>
              {/* Absent entirely when their local currency IS the one above — see useBalanceDisplay. */}
              {secondary ? <Txt style={styles.secondary}>{secondary}</Txt> : null}
            </>
          ) : (
            <Skeleton w={210} h={52} r={12} />
          )}
        </View>

        {/* four Google-Pay-style actions */}
        <View style={styles.actions}>
          <ActionBtn label="Scan" onPress={() => open('scan')} icon={<Icons.QrBig size={24} color={colors.accent} />} />
          <ActionBtn label="Send" onPress={() => open('send')} icon={<Icons.Send size={24} color={colors.accent} />} />
          <ActionBtn label="Request" onPress={() => open('request')} icon={<Icons.Request size={24} color={colors.accent} />} />
          <ActionBtn label="Add" onPress={() => open('add')} icon={<Icons.Plus size={24} color={colors.accent} />} />
        </View>

        {/* recent activity */}
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
      </View>
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
  scroll: { flex: 1, paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 4, paddingLeft: 2, paddingRight: 2 },
  barBtn: { position: 'relative', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, right: 6, width: 9, height: 9, borderRadius: 9, backgroundColor: colors.coral, border: `1.5px solid ${colors.canvas}` },

  // The pill and the label are gone, so the number carries the space that used to hold them —
  // padding, not a taller block, so the actions keep their position on a short viewport.
  hero: { alignItems: 'center', marginTop: 6, paddingTop: 34, paddingBottom: 34 },
  heroAmt: { flexDirection: 'row', alignItems: 'baseline' },
  symbol: { fontSize: 28, color: colors.tertiary, marginRight: 2 },
  secondary: { ...type.sub, fontSize: 16, marginTop: 10 },

  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginBottom: 4, paddingLeft: 4, paddingRight: 4 },
  action: { alignItems: 'center', gap: 8 },
  actionIcon: {
    width: 58,
    height: 58,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.card,
  },

  recent: { marginTop: 30 },
  rh: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 2, paddingRight: 2, paddingBottom: 12 },
  txList: { gap: 10 },
} satisfies Record<string, CSSProperties>;
