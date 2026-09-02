'use client';

// /account/stake-back — ask for stake back. Debits the bond now; the USDC is sent by hand to the wallet
// they name (their fpay wallet by default). The terms are on this screen, not on a page nobody reads:
// how long it can take, and the one thing that can refuse it.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BackButton } from '@fpay/ui/BackButton';
import { Btn } from '@fpay/ui/Button';
import { SearchBar, Spacer } from '@fpay/ui/primitives';
import { ScrollView, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { payoutAddressOrNull, styles } from '@/components/OneField';
import { friendlyError } from '@/lib/errors';
import { colors, type } from '@fpay/ui/theme';
import { requestStakeWithdrawal } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

export default function StakeBack() {
  const router = useRouter();
  const m = useLpStore((s) => s.merchant);
  const load = useLpStore((s) => s.load);
  const notify = useLpStore((s) => s.notify);
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState(m?.payoutWallet ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setErr('Enter an amount, like 50.');
    setBusy(true);
    setErr(null);
    try {
      await requestStakeWithdrawal(n, payoutAddressOrNull(to, m?.payoutWallet));
      await load();
      notify('On its way back. We send it by hand, usually within a day.', 'success');
      router.push('/account');
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push('/account')} />
      </View>
      <ScrollView style={styles.scroll}>
        <Txt style={type.handle}>Take stake back</Txt>
        <Txt style={[type.lead, { marginTop: 8 }]}>
          {`Sent by hand, usually within a day. It can’t leave while a payout you handled is less than ${m?.clawWindowHours ?? 72} hours old.`}
        </Txt>
        <Txt style={[type.kvKey, { marginTop: 18, marginBottom: 8 }]}>How much, in dollars</Txt>
        <SearchBar placeholder="50" value={amount} onChangeText={(t: string) => { setAmount(t); setErr(null); }} />
        <Txt style={[type.kvKey, { marginTop: 18, marginBottom: 8 }]}>Send it to</Txt>
        <SearchBar placeholder="Solana address" value={to} onChangeText={(t: string) => { setTo(t); setErr(null); }} />
        <Txt style={[type.rowTime, { marginTop: 6 }]}>Your fpay wallet is filled in. Any Solana address that holds USDC works.</Txt>
        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 10 }]}>{err}</Txt> : null}
        <Spacer />
        <Btn label={busy ? 'Asking…' : 'Take it back'} variant="ink" disabled={busy} onPress={() => void go()} />
      </ScrollView>
    </Screen>
  );
}
