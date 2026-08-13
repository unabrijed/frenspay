'use client';

// Transaction detail — full screen: result hero, rate-lock (merchant pays), detail list.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

import { Icons } from '@/components/icons';
import { RateLock } from '@/components/RateLock';
import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { MaskedAmount } from '@/components/ui/MaskedAmount';
import { List, ResultBadge, Row, RowAmount, RowMeta, Spacer } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { inrRaw, usd } from '@/lib/money';
import { colors, fonts, GUTTER, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

export default function Detail() {
  const router = useRouter();
  const tx = usePayStore((s) => s.detail) ?? usePayStore((s) => s.transactions[0]);
  const hideAmounts = usePayStore((s) => s.hideAmounts);
  // No tx to show (e.g. opened directly / no state) → go back. In an effect so it never runs
  // during server prerender, where touching the router would hit `window is not defined`.
  useEffect(() => {
    if (!tx) router.back();
  }, [tx, router]);
  if (!tx) return null;
  const merchant = tx.type === 'pay';
  const isAdd = tx.type === 'add';

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={[styles.scroll, { overflowY: 'auto' }]}>
        <View style={styles.fhead}>
          <BackButton onPress={() => router.back()} />
        </View>

        <View style={styles.result}>
          <ResultBadge kind={isAdd || merchant ? 'ok' : 'no'}>
            {isAdd ? (
              <Icons.Plus size={26} color={colors.accent} />
            ) : merchant ? (
              <Icons.Check size={30} color={colors.accent} />
            ) : (
              <Icons.Send size={24} color={colors.muted} />
            )}
          </ResultBadge>
          {/* This page bypasses useBalanceDisplay/TxCard, so the eye is honored here explicitly. */}
          <MaskedAmount value={merchant ? inrRaw(tx.rupees ?? 0) : usd(Math.abs(tx.usd))} style={type.result} />
          <Txt style={[type.reassure, { color: colors.muted }]}>{tx.title}</Txt>
        </View>

        {merchant ? (
          <View style={{ marginTop: 22 }}>
            <RateLock payUsd={Math.abs(tx.usd)} getR={tx.rupees ?? 0} />
          </View>
        ) : null}

        <View style={{ marginTop: 16 }}>
          <List>
            <DetailRow k="Status" v={isAdd ? 'Added' : 'Paid'} accent />
            <DetailRow k={isAdd ? 'Method' : 'Paid from'} v={isAdd ? 'Apple Pay' : hideAmounts ? '••••' : usd(Math.abs(tx.usd))} />
            <DetailRow k="Date" v="14 Jun, 09:24" />
            <DetailRow k="Reference" v="#577665" />
          </List>
        </View>

        <Spacer />
        <View style={styles.cta}>
          <Btn label="Share receipt" variant="secondary" onPress={() => router.back()} />
        </View>
      </View>
    </Screen>
  );
}

function DetailRow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <Row>
      <RowMeta>
        <Txt style={styles.label}>{k}</Txt>
      </RowMeta>
      <RowAmount>
        <Txt style={[type.rowAmount, accent && { color: colors.accent }]}>{v}</Txt>
      </RowAmount>
    </Row>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1, paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 4, paddingBottom: 24 },
  fhead: { paddingTop: 8, paddingBottom: 6, paddingLeft: 2, paddingRight: 2 },
  result: { alignItems: 'center', gap: 10, paddingTop: 2 },
  label: { ...fonts.body400, fontSize: 15, color: colors.muted },
  cta: { paddingTop: 16 },
} satisfies Record<string, CSSProperties>;
