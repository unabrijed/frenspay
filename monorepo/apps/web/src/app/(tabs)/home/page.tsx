'use client';

// Home — INR-forward balance with an INR/USD toggle, Add/Send/Request tiles, recent activity.
import { useRouter } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';

import { Icons } from '@/components/icons';
import { TxRow } from '@/components/TxRow';
import { Pressable, View } from '@/components/ui/rn';
import { Avatar, Eyebrow, List, Logo, Spacer } from '@/components/ui/primitives';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { Txt } from '@/components/ui/Txt';
import { inr, usd } from '@/lib/money';
import { colors, fonts, GUTTER, radii, shadows, tile, type } from '@/lib/theme';
import type { TileTone } from '@/lib/theme';
import type { Txn } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

export default function Home() {
  const router = useRouter();
  const bal = usePayStore((s) => s.balanceUSD);
  const txns = usePayStore((s) => s.transactions);
  const open = usePayStore((s) => s.open);
  const openDetail = usePayStore((s) => s.openDetail);
  const [lead, setLead] = useState<'INR' | 'USD'>('INR');
  const leadINR = lead === 'INR';

  const openTx = (tx: Txn) => {
    openDetail(tx);
    router.push('/detail');
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.scroll}>
        <View style={styles.top}>
          <View style={styles.brand}>
            <Logo />
            <Txt style={type.brandWord}>Pay</Txt>
          </View>
          <Avatar label="B" onPress={() => router.push('/settings')} />
        </View>

        {/* hero — solid violet card */}
        <View style={styles.hero}>
          <View style={styles.toggle}>
            <Eyebrow style={styles.heroEyebrow}>{leadINR ? 'Spendable in India' : 'Balance'}</Eyebrow>
            <Segmented value={lead} options={['INR', 'USD']} onChange={(v) => setLead(v as 'INR' | 'USD')} onDark />
          </View>
          <Txt style={[type.heroBalance, styles.heroBal]}>{leadINR ? inr(bal) : usd(bal)}</Txt>
          <Txt style={[type.sub, styles.heroSub]}>
            {leadINR ? (
              <>
                <Txt style={styles.subBold}>{usd(bal)}</Txt> balance · 1 USD = 87.55 INR
              </>
            ) : (
              <>~ {inr(bal)} · 1 USD = 87.55 INR</>
            )}
          </Txt>
          <Txt style={[type.note, styles.heroNote]}>
            Your dollars, spent in rupees at a rate locked the moment you pay.
          </Txt>
        </View>

        {/* action tiles — flat colour blocks */}
        <View style={styles.tiles}>
          <Tile tone="add" icon={<Icons.Plus size={18} color={tile.add.fg} />} label="Add" onPress={() => open('add')} />
          <Tile tone="send" icon={<Icons.Send size={18} color={tile.send.fg} />} label="Send" onPress={() => open('send')} />
          <Tile tone="request" icon={<Icons.Request size={18} color={tile.request.fg} />} label="Request" onPress={() => open('request')} />
        </View>

        {/* recent */}
        <View style={styles.recent}>
          <View style={styles.rh}>
            <Eyebrow>Recent</Eyebrow>
            <Pressable onPress={() => router.push('/activity')}>
              <Txt style={type.seeAll}>See all</Txt>
            </Pressable>
          </View>
          <List>
            {txns.slice(0, 2).map((tx) => (
              <TxRow key={tx.id} tx={tx} onPress={() => openTx(tx)} />
            ))}
          </List>
        </View>

        <Spacer />
      </View>
    </Screen>
  );
}

function Tile({ tone, icon, label, onPress }: { tone: TileTone; icon: ReactNode; label: string; onPress: () => void }) {
  const t = tile[tone];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: t.bg }, pressed && { transform: 'scale(0.97)' }]}
    >
      {icon}
      <Txt style={[type.tileLabel, { color: t.fg }]}>{label}</Txt>
    </Pressable>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1, paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 4,
    paddingRight: 4,
    paddingTop: 8,
    paddingBottom: 2,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  hero: {
    marginTop: 14,
    backgroundColor: colors.accent,
    borderRadius: radii.rlc,
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 18,
    paddingBottom: 20,
    boxShadow: shadows.rlc,
  },
  heroEyebrow: { color: 'rgba(255,255,255,0.85)' },
  heroBal: { color: colors.white, marginTop: 12 },
  heroSub: { marginTop: 10, color: 'rgba(255,255,255,0.92)' },
  heroNote: { marginTop: 12, maxWidth: 300, color: 'rgba(255,255,255,0.80)' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 24 },
  subBold: { ...fonts.mono500, color: colors.white },
  tiles: { flexDirection: 'row', gap: 11, marginTop: 18 },
  tile: {
    flex: 1,
    borderRadius: radii.tile,
    paddingTop: 15,
    paddingBottom: 14,
    paddingLeft: 14,
    paddingRight: 14,
    alignItems: 'flex-start',
    gap: 14,
    boxShadow: shadows.card,
  },
  recent: { marginTop: 24 },
  rh: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 2,
    paddingRight: 2,
    paddingBottom: 10,
  },
} satisfies Record<string, CSSProperties>;
