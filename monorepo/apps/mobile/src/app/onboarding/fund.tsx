// Add first dollars — the devnet faucet; on mainnet the step doesn't exist and skips to Home with
// $0. Port of the web's onboarding/fund/page.tsx.
import { usePayStore, useStoreHydrated, wallet } from '@fpay/app';
import { BackButton, Btn, Chip, Chips, colors, Field, Input, Screen, Spacer, TextLink, Txt, type, View } from '@fpay/ui';
import { useRouter } from 'expo-router';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { Splash } from '@/components/Splash';
import { IS_MAINNET } from '@/services/envConfig';

const CHIPS = [50, 100, 250];

export default function Fund() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const authStatus = usePayStore((s) => s.authStatus);
  const completeOnboarding = usePayStore((s) => s.completeOnboarding);
  const load = usePayStore((s) => s.load);
  const [amt, setAmt] = useState(100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && authStatus !== 'signedIn') router.replace('/');
  }, [hydrated, authStatus, router]);

  const done = useCallback(() => {
    completeOnboarding();
    void load();
    router.replace('/home');
  }, [completeOnboarding, load, router]);

  useEffect(() => {
    if (IS_MAINNET && hydrated && authStatus === 'signedIn') done();
  }, [hydrated, authStatus, done]);

  const finish = async () => {
    setErr(null);
    setBusy(true);
    try {
      await wallet.addMoney?.(amt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    done();
  };

  if (!hydrated || authStatus !== 'signedIn' || IS_MAINNET) return <Splash />;

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
        <Input
          value={amt ? String(amt) : ''}
          onChangeText={(v) => {
            const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
            setAmt(Number.isNaN(n) ? 0 : Math.min(n, 1000));
          }}
          keyboardType="decimal"
          placeholder="0"
          style={[type.fieldText, { flex: 1, minWidth: 0 }]}
        />
      </Field>
      <Txt style={[type.lead, { fontSize: 13, marginTop: 10 }]}>Added to your balance instantly.</Txt>
      {err ? <Txt style={[type.lead, { fontSize: 13, color: colors.danger }]}>{err}</Txt> : null}
      <Spacer />
      <View style={styles.cta}>
        <Btn label={busy ? 'Adding…' : `Add $${amt}`} disabled={amt <= 0 || busy} pending={busy} onPress={finish} />
        <TextLink label="Skip for now" onPress={done} />
      </View>
    </Screen>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas, paddingLeft: 24, paddingRight: 24, paddingTop: 8, paddingBottom: 26 },
  fhead: { paddingBottom: 2, marginBottom: 13 },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
