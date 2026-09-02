'use client';

// /account/leave — the way out. A flag, never a delete: the ledger and the history stay (docs/15). The
// whole stake becomes one withdrawal, sent by hand to the wallet they name. Final, and said so.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { usd } from '@fpay/shared';

import { BackButton } from '@fpay/ui/BackButton';
import { Btn } from '@fpay/ui/Button';
import { SearchBar, Spacer } from '@fpay/ui/primitives';
import { ScrollView, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { payoutAddressOrNull, styles } from '@/components/OneField';
import { friendlyError } from '@/lib/errors';
import { colors, type } from '@fpay/ui/theme';
import { exitMerchant } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

export default function Leave() {
  const router = useRouter();
  const m = useLpStore((s) => s.merchant);
  const load = useLpStore((s) => s.load);
  const notify = useLpStore((s) => s.notify);
  const [to, setTo] = useState(m?.payoutWallet ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await exitMerchant(payoutAddressOrNull(to, m?.payoutWallet));
      await load();
      notify('You’ve left. Your stake is on its way back.', 'success');
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
        <Txt style={type.handle}>Leave fpay</Txt>
        <Txt style={[type.lead, { marginTop: 8 }]}>{`Your whole stake, ${usd(m?.bondUsdc ?? '0')}, comes back by hand, usually within a day.`}</Txt>
        <Txt style={[type.lead, { marginTop: 6 }]}>You keep your history and can still sign in. You won’t be offered orders again.</Txt>
        <Txt style={[type.lead, { marginTop: 6 }]}>This can’t be undone from here.</Txt>
        <Txt style={[type.kvKey, { marginTop: 18, marginBottom: 8 }]}>Send it to</Txt>
        <SearchBar placeholder="Solana address" value={to} onChangeText={(t: string) => { setTo(t); setErr(null); }} />
        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 10 }]}>{err}</Txt> : null}
        <Spacer />
        <Btn label={busy ? 'Leaving…' : 'Leave fpay'} variant="primary" disabled={busy} onPress={() => void go()} />
      </ScrollView>
    </Screen>
  );
}
