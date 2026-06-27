'use client';

// Add first dollars — funds the wallet via the devnet faucet, then completes onboarding → Home.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { Chip, Chips, Field, Spacer } from '@/components/ui/primitives';
import { sx, View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { Screen } from '@/components/ui/Screen';
import { colors, type } from '@/lib/theme';
import { wallet } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

const CHIPS = [50, 100, 250];

export default function Fund() {
  const router = useRouter();
  const completeOnboarding = usePayStore((s) => s.completeOnboarding);
  const load = usePayStore((s) => s.load);
  const [amt, setAmt] = useState(100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const finish = async () => {
    setErr(null);
    setBusy(true);
    try {
      await wallet.addMoney?.(amt); // devnet faucet → mints test USDC into the user's wallet
      completeOnboarding();
      await load(); // pull the funded balance before landing on Home
      router.replace('/home');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.fhead}>
        <BackButton onPress={() => router.back()} />
      </View>
      <Txt style={type.onbH1}>Add your first dollars</Txt>
      <Txt style={[type.lead, { fontSize: 15 }]}>Load once, then spend in rupees anywhere.</Txt>
      <View style={{ marginTop: 10 }}>
        <Chips>
          {CHIPS.map((v) => (
            <Chip key={v} label={`$${v}`} on={amt === v} onPress={() => setAmt(v)} />
          ))}
        </Chips>
      </View>
      <Field style={{ marginTop: 12 }}>
        <Txt style={[type.fieldText, { color: colors.muted }]}>$</Txt>
        <input
          value={amt ? String(amt) : ''}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10);
            setAmt(Number.isNaN(n) ? 0 : Math.min(n, 1000));
          }}
          inputMode="decimal"
          placeholder="0"
          style={sx(type.fieldText, { flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: 0, color: colors.ink })}
        />
      </Field>
      <Txt style={[type.lead, { fontSize: 13, marginTop: 10 }]}>Added to your balance instantly.</Txt>
      {err ? <Txt style={[type.lead, { fontSize: 13, color: colors.danger }]}>{err}</Txt> : null}
      <Spacer />
      <View style={styles.cta}>
        <Btn label={busy ? 'Adding…' : `Add $${amt}`} disabled={amt <= 0 || busy} onPress={finish} />
      </View>
    </Screen>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas, paddingLeft: 24, paddingRight: 24, paddingTop: 8, paddingBottom: 26 },
  fhead: { paddingBottom: 2, marginBottom: 13 },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
