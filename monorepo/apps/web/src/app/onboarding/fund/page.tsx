'use client';

// Add first dollars — funds the wallet via the devnet faucet, then completes onboarding → Home.
//
// Funding is OPTIONAL. It reads as the last step of signup, but the account is already real by the
// time anyone gets here — /auth/sync ran back on the handle step. Making it the only way out meant
// the faucet could hold a signup hostage: a drained devnet treasury answers `faucet_empty`, which
// is expected rather than a bug, and there was no way past it. An empty balance is a fine place to
// start; Add money is one tap from Home.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { BackButton } from '@/components/ui/BackButton';
import { Btn, TextLink } from '@/components/ui/Button';
import { Chip, Chips, Field, Spacer } from '@/components/ui/primitives';
import { Splash } from '@/components/ui/Splash';
import { sx, View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { Screen } from '@/components/ui/Screen';
import { colors, type } from '@/lib/theme';
import { IS_MAINNET } from '@/services/envConfig';
import { wallet } from '@/services/wallet';
import { usePayStore, useStoreHydrated } from '@/store/usePayStore';

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

  // Step guard: funding signs a wallet transaction — bounce to the entry router if we land here
  // without a signed-in session (direct URL / reload before the Privy bridge re-signs in).
  useEffect(() => {
    if (hydrated && authStatus !== 'signedIn') router.replace('/');
  }, [hydrated, authStatus, router]);

  /** Onboarding is over: land on Home. The mainnet auto-skip, the funded path and the manual skip
   *  all finish identically — the only thing funding changes is the balance you arrive with. */
  const done = useCallback(() => {
    completeOnboarding();
    void load(); // best-effort prefetch; Home skeletons until it or the 12s LiveSync lands
    router.replace('/home');
  }, [completeOnboarding, load, router]);

  // This step IS the devnet faucet, so on mainnet it doesn't exist: whoever routes here (the handle
  // step, the entry router resuming a half-onboarded user) skips straight to Home with $0 — Add
  // money shows their deposit address instead. One guard at the sink covers every path in.
  useEffect(() => {
    if (IS_MAINNET && hydrated && authStatus === 'signedIn') done();
  }, [hydrated, authStatus, done]);

  const finish = async () => {
    setErr(null);
    setBusy(true);
    try {
      await wallet.addMoney?.(amt); // devnet faucet → mints test USDC. The only step that can hard-fail.
    } catch (e) {
      // Funding failed → stay here so they can retry or skip. `faucet_empty` (a drained devnet
      // treasury) is the common one and no amount of retrying fixes it, which is why the skip
      // below has to remain reachable from this state.
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
        <Btn label={busy ? 'Adding…' : `Add $${amt}`} disabled={amt <= 0 || busy} pending={busy} onPress={finish} />
        {/* Not disabled while funding is in flight: if the faucet hangs, this is the way out. */}
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
