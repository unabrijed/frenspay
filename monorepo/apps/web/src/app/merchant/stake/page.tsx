'use client';

// /merchant/stake — put real money behind the promise. The stake is what makes a stranger's payout
// safe to route to this merchant: an upheld dispute takes from it, and falling under the minimum
// takes them out of routing entirely.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { Keypad } from '@/components/ui/Keypad';
import { Spacer } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { usd } from '@/lib/money';
import { colors, GUTTER, radii, type } from '@/lib/theme';
import { depositStake } from '@/services/merchant';
import { usePayStore } from '@/store/usePayStore';

export default function MerchantStake() {
  const router = useRouter();
  const merchant = usePayStore((s) => s.merchant);
  const balanceUSD = usePayStore((s) => s.balanceUSD);
  const load = usePayStore((s) => s.load);
  const notify = usePayStore((s) => s.notify);
  const [d, setD] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amount = parseInt(d || '0', 10);
  const press = (k: string) => {
    if (k === '⌫') setD((s) => s.slice(0, -1));
    else if (d.length < 6) setD((s) => (s === '0' ? '' : s) + k);
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await depositStake(amount);
      setD('');
      // The bond credits only when the transfer confirms on-chain, so don't claim it's live yet.
      notify('Stake sent. It’ll show up once it confirms.', 'success');
      await load();
      router.push('/merchant');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  // Redirect in an effect, not during render — the client router touches `location`, which
  // doesn't exist while this page is being statically prerendered.
  useEffect(() => {
    if (!merchant) router.replace('/merchant');
  }, [merchant, router]);
  if (!merchant) return null;

  // Number() at the point of use: these are decimal strings on the wire, and `-` / `<` on a string
  // is either a coercion or a LEXICAL compare ("900.000000" < "2000.000000" is false).
  const shortfall = Math.max(0, Number(merchant.minBondUsdc) - Number(merchant.bondUsdc));

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push('/merchant')} />
      </View>
      <View style={styles.scroll}>
        <View style={styles.current}>
          <Txt style={type.kvKey}>Staked now</Txt>
          <Txt style={[type.rowAmount, { fontSize: 20, marginTop: 2 }]}>{usd(merchant.bondUsdc)}</Txt>
          <Txt style={[type.inst, shortfall > 0 ? { color: colors.danger } : null]}>
            {shortfall > 0
              ? `Add ${usd(shortfall)} to reach the ${usd(merchant.minBondUsdc)} minimum.`
              : `Minimum ${usd(merchant.minBondUsdc)}, you’re covered.`}
          </Txt>
        </View>

        <View style={styles.amountbig}>
          <Txt style={[type.bigAmount, { color: colors.ink }]}>{usd(amount)}</Txt>
          <Txt style={type.conv}>{usd(balanceUSD)} available</Txt>
        </View>
        <Keypad onPress={press} />

        {err ? <Txt style={[type.lead, { color: colors.danger, marginBottom: 10 }]}>{err}</Txt> : null}
        <Txt style={[type.inst, { marginBottom: 12 }]}>
          Held while you’re a merchant. If someone you were meant to pay doesn’t get their money, this
          is what makes them whole.
        </Txt>

        <Spacer />
        <Btn
          label={busy ? 'Confirming…' : 'Add to stake'}
          variant="ink"
          disabled={busy || amount <= 0 || amount > balanceUSD}
          onPress={() => void submit()}
        />
      </View>
    </Screen>
  );
}

const styles = {
  safe: { backgroundColor: colors.canvas },
  head: { paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 6, paddingBottom: 2 },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    paddingLeft: GUTTER,
    paddingRight: GUTTER,
    paddingBottom: 28,
  },
  current: { padding: 16, borderRadius: radii.card, backgroundColor: colors.surface, marginBottom: 10 },
  amountbig: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 18, paddingBottom: 18 },
} satisfies Record<string, CSSProperties>;
