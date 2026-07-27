'use client';

// /merchant/apply — become an LP. Creates a pending-KYB merchant bound to this user; an admin
// approves it, and staking is what actually brings them online.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { SearchBar, Spacer } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { colors, GUTTER, type } from '@/lib/theme';
import { applyAsMerchant } from '@/services/merchant';
import { usePayStore } from '@/store/usePayStore';

export default function MerchantApply() {
  const router = useRouter();
  const walletAddress = usePayStore((s) => s.walletAddress);
  const load = usePayStore((s) => s.load);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Settle to their own wallet — the address we already hold. Asking them to paste one is a
      // typo waiting to become an irreversible payout to a stranger.
      await applyAsMerchant({ name: name.trim(), payoutMethod: 'UPI', treasuryAddress: walletAddress });
      await load(); // /me now carries the merchant profile
      router.push('/merchant');
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push('/merchant')} />
      </View>
      <View style={styles.scroll}>
        <Txt style={type.handle}>Apply as a merchant</Txt>
        <Txt style={[type.lead, { marginTop: 10, marginBottom: 22 }]}>
          You’ll pay people in rupees from your own account and get paid back here, plus a spread. You
          put up a stake first — if you don’t pay someone, it covers them.
        </Txt>

        <Txt style={[type.kvKey, { marginBottom: 8 }]}>Business name</Txt>
        <SearchBar placeholder="e.g. Anjuna Exchange" value={name} onChangeText={setName} />

        <Txt style={[type.inst, { marginTop: 18 }]}>
          Payouts settle to your fpay balance. We’ll review your application before you can take orders.
        </Txt>

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 14 }]}>{err}</Txt> : null}

        <Spacer />
        <Btn
          label={busy ? 'Submitting…' : 'Apply'}
          variant="ink"
          disabled={busy || name.trim().length < 2 || !walletAddress}
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
} satisfies Record<string, CSSProperties>;
