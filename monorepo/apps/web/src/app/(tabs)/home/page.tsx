'use client';

// Home — Tabroad dashboard (matches the Stitch reference): top app bar, "Active in India" global-balance
// hero, four Google-Pay-style action buttons (Scan / Send / Request / Add), a wallets bento
// (USD Wallet · INR · Add Currency), and recent activity as individual tactile cards.
import { useRouter } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';

import { Icons } from '@/components/icons';
import { TxCard } from '@/components/TxCard';
import { Avatar } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { inr, usd } from '@/lib/money';
import { colors, GUTTER, radii, shadows, type } from '@/lib/theme';
import type { Txn } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

const fmtUsd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Home() {
  const router = useRouter();
  const bal = usePayStore((s) => s.balanceUSD);
  const txns = usePayStore((s) => s.transactions);
  const handle = usePayStore((s) => s.handle);
  const open = usePayStore((s) => s.open);
  const openDetail = usePayStore((s) => s.openDetail);
  const unread = usePayStore((s) => s.unread);
  const initial = (handle.replace(/^@/, '')[0] ?? 'U').toUpperCase();

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
          <Txt style={type.brandWord}>Tabroad</Txt>
          <Pressable onPress={() => open('notifications')} style={({ pressed }) => [styles.barBtn, pressed ? { opacity: 0.6 } : null]}>
            <Icons.Bell size={26} color={colors.accent} />
            {unread > 0 ? <View style={styles.badge} /> : null}
          </Pressable>
        </View>

        {/* global-balance hero */}
        <View style={styles.hero}>
          <View style={styles.locPill}>
            <Icons.Pin size={16} color={colors.secondary} />
            <Txt style={type.eyebrow}>Active in India</Txt>
          </View>
          <Txt style={[type.sub, { marginTop: 18 }]}>Global balance</Txt>
          <View style={styles.heroAmt}>
            <Txt style={[type.heroBalance, styles.dollar]}>$</Txt>
            <Txt style={type.heroBalance}>{fmtUsd(bal)}</Txt>
          </View>
        </View>

        {/* four Google-Pay-style actions */}
        <View style={styles.actions}>
          <ActionBtn label="Scan" onPress={() => open('scan')} icon={<Icons.QrBig size={24} color={colors.accent} />} />
          <ActionBtn label="Send" onPress={() => open('send')} icon={<Icons.Send size={24} color={colors.accent} />} />
          <ActionBtn label="Request" onPress={() => open('request')} icon={<Icons.Request size={24} color={colors.accent} />} />
          <ActionBtn label="Add" onPress={() => open('add')} icon={<Icons.Plus size={24} color={colors.accent} />} />
        </View>

        {/* wallets bento */}
        <View style={styles.bento}>
          <View style={styles.usdCard}>
            <View style={styles.usdTop}>
              <View style={styles.usdIcon}>
                <Icons.Wallet size={22} color={colors.secondary} />
              </View>
              <Txt style={[type.tierTag, styles.primaryTag]}>PRIMARY</Txt>
            </View>
            <View>
              <Txt style={type.sub}>US Dollars</Txt>
              <Txt style={[type.payeeWho, { fontSize: 24, marginTop: 2 }]}>{usd(bal)}</Txt>
            </View>
          </View>
          <View style={styles.bentoRow}>
            <View style={styles.smallCard}>
              <View style={styles.rupeeCircle}>
                <Txt style={styles.rupeeGlyph}>₹</Txt>
              </View>
              <View>
                <Txt style={[type.eyebrow, { marginBottom: 2 }]}>INR</Txt>
                <Txt style={[type.payeeWho, { fontSize: 18 }]}>{inr(bal)}</Txt>
              </View>
            </View>
            <Pressable onPress={() => open('add')} style={({ pressed }) => [styles.addCard, pressed ? { backgroundColor: colors.surfaceHigh } : null]}>
              <Icons.Plus size={26} color={colors.tertiary} />
              <Txt style={[type.tierTag, { color: colors.tertiary, marginTop: 6 }]}>Add Currency</Txt>
            </Pressable>
          </View>
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
            {txns.length === 0 ? (
              <Txt style={[type.lead, { textAlign: 'center', paddingTop: 6 }]}>No activity yet.</Txt>
            ) : (
              txns.slice(0, 3).map((tx) => <TxCard key={tx.id} tx={tx} onPress={() => openTx(tx)} />)
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

const card: CSSProperties = {
  backgroundColor: colors.surface,
  borderRadius: radii.card,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: colors.outlineVariant,
  boxShadow: shadows.card,
};

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1, paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 4, paddingLeft: 2, paddingRight: 2 },
  barBtn: { position: 'relative', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, right: 6, width: 9, height: 9, borderRadius: 9, backgroundColor: colors.coral, border: `1.5px solid ${colors.canvas}` },

  hero: { alignItems: 'center', marginTop: 10, paddingTop: 14, paddingBottom: 20 },
  locPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceHigh,
    paddingLeft: 12,
    paddingRight: 14,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 999,
    boxShadow: shadows.segPill,
  },
  heroAmt: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  dollar: { fontSize: 28, color: colors.tertiary, marginRight: 2 },

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

  bento: { marginTop: 22, gap: 12 },
  usdCard: { ...card, padding: 18, gap: 16 },
  usdTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  usdIcon: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.secondarySoft, alignItems: 'center', justifyContent: 'center' },
  primaryTag: { backgroundColor: colors.secondarySoft, color: colors.secondary, paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 8 },
  bentoRow: { flexDirection: 'row', gap: 12 },
  smallCard: { ...card, flex: 1, height: 124, padding: 16, justifyContent: 'space-between' },
  rupeeCircle: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.outline,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rupeeGlyph: { fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 16, color: colors.ink },
  addCard: {
    flex: 1,
    height: 124,
    borderRadius: radii.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recent: { marginTop: 26 },
  rh: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 2, paddingRight: 2, paddingBottom: 12 },
  txList: { gap: 10 },
} satisfies Record<string, CSSProperties>;
