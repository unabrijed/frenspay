'use client';

// Home — fpay dashboard (matches the Stitch reference): top app bar, "Active in India" global-balance
// hero, four Google-Pay-style action buttons (Scan / Send / Request / Add), a wallets bento
// (USD Wallet · INR · Add Currency), and recent activity as individual tactile cards.
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
import { fiatSymbol, inr, usd } from '@/lib/money';
import { colors, GUTTER, radii, shadows, type } from '@/lib/theme';
import type { Txn } from '@/services/wallet';
import { RAILS } from '@fpay/shared';
import { usePayStore } from '@/store/usePayStore';

const fmtUsd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "India & Indonesia" — derived from the rails registry (the only country list, docs/21), so a
// corridor going live never leaves this hero line behind.
const region = (iso: string): string => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(iso) ?? iso;
  } catch {
    return iso;
  }
};
const ACTIVE_IN = RAILS.filter((r) => r.live).map((r) => region(r.country)).join(' & ');

export default function Home() {
  const router = useRouter();
  const pollKyc = usePayStore((s) => s.pollKyc);
  const bal = usePayStore((s) => s.balanceUSD);
  const fxRate = usePayStore((s) => s.fxRate);
  const displayCurrency = usePayStore((s) => s.displayCurrency);
  const txns = usePayStore((s) => s.transactions);
  const loaded = usePayStore((s) => s.firstLoadDone);
  const handle = usePayStore((s) => s.handle);
  const open = usePayStore((s) => s.open);
  const openDetail = usePayStore((s) => s.openDetail);
  const unread = usePayStore((s) => s.unread);
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

        {/* global-balance hero */}
        <View style={styles.hero}>
          <View style={styles.locPill}>
            <Icons.Pin size={16} color={colors.secondary} />
            <Txt style={type.eyebrow}>Active in {ACTIVE_IN}</Txt>
          </View>
          <Txt style={[type.sub, { marginTop: 18 }]}>Global balance</Txt>
          {loaded ? (
            <View className="fp-arrive" style={styles.heroAmt}>
              {/* Strip exactly the symbol's own length — 'Rp' is two chars, so a hardcoded slice(1)
                  would leak a stray letter the day a multi-char symbol lands here. */}
              <Txt style={[type.heroBalance, styles.dollar]}>{displayCurrency === 'USD' ? '$' : fiatSymbol(displayCurrency)}</Txt>
              <Txt style={type.heroBalance}>{displayCurrency === 'USD' ? fmtUsd(bal) : inr(bal, fxRate).slice(fiatSymbol(displayCurrency).length)}</Txt>
            </View>
          ) : (
            <Skeleton w={190} h={44} r={12} style={{ marginTop: 8 }} />
          )}
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
              {loaded ? (
                <Txt style={[type.payeeWho, { fontSize: 24, marginTop: 2 }]}>{usd(bal)}</Txt>
              ) : (
                <Skeleton w={104} h={22} style={{ marginTop: 6 }} />
              )}
            </View>
          </View>
          <View style={styles.bentoRow}>
            <View style={styles.smallCard}>
              <View style={styles.rupeeCircle}>
                <Txt style={styles.rupeeGlyph}>₹</Txt>
              </View>
              <View>
                <Txt style={[type.eyebrow, { marginBottom: 2 }]}>INR</Txt>
                {loaded ? (
                  <Txt style={[type.payeeWho, { fontSize: 18 }]}>{inr(bal, fxRate)}</Txt>
                ) : (
                  <Skeleton w={76} h={17} style={{ marginTop: 4 }} />
                )}
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
            {!loaded ? (
              <TxListSkeleton rows={3} />
            ) : txns.length === 0 ? (
              <Empty label="No activity yet." />
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
