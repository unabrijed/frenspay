'use client';

// /apply — become an LP. Creates a pending-KYB merchant bound to this user; an admin
// approves it, and staking is what actually brings them online.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { Btn } from '@fpay/ui/Button';
import { SearchBar, Spacer } from '@fpay/ui/primitives';
import { ScrollView } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { StepHeader } from '@/components/StepHeader';
import { friendlyError } from '@/lib/errors';
import { colors, GUTTER, type } from '@fpay/ui/theme';
import { applyAsMerchant } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

export default function MerchantApply() {
  const router = useRouter();
  const walletAddress = useLpStore((s) => s.walletAddress);
  const kycTier = useLpStore((s) => s.kycTier);
  // With the vendor off nobody can reach tier 2, so this wall would close the funnel outright. The
  // server drops the same gate on the same flag; the human reading the business form checks identity
  // instead (docs/14). Keep the two in step — a client-only bypass would just 403.
  const identityCheckAvailable = useLpStore((s) => s.identityCheckAvailable);
  const load = useLpStore((s) => s.load);
  const [name, setName] = useState('');
  // Prefilled with the corridor's dial code — this form is UPI-only, so it is always India.
  const [phone, setPhone] = useState('+91 ');
  const [busy, setBusy] = useState(false);
  // Re-read /me on mount. Both screens branch on identityCheckAvailable, and the store writes it only
  // in load() — which for a not-yet-partner runs once at sign-in and never again (the home poll fetches
  // orders, and is gated on already being a partner). An operator flipping the credential in Railway
  // would otherwise strand a stale tab: showing the application form the server now 403s, with no
  // Verify button on screen to escape to, until a hard reload.
  useEffect(() => {
    void load();
  }, [load]);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Settle to their own wallet — the address we already hold. Asking them to paste one is a
      // typo waiting to become an irreversible payout to a stranger.
      await applyAsMerchant({
        name: name.trim(),
        payoutMethod: 'UPI',
        treasuryAddress: walletAddress,
        contactPhone: phone.replace(/\s/g, ''),
      });
      await load(); // /me now carries the merchant profile
      router.push('/details'); // step 2 of the chain
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      {/* Step 1 has no previous step: no back button (Home is where this came from). */}
      <ScrollView style={styles.scroll}>
        <StepHeader step={1} />
        <Txt style={type.handle}>Apply as a partner</Txt>
        <Txt style={[type.lead, { marginTop: 10, marginBottom: 22 }]}>
          You pay people in rupees from your own account and get paid back here, plus a spread.
        </Txt>

        {/* Merchant KYC: the human behind the merchant must be identity-verified before the form.
            The server enforces the same gate (403 kyc_required); this is just the friendly path.
            In the wallet app this opened a sheet; here it is a route, because this console has no
            sheet layer and one screen is cheaper than one. The store's KYC poll flips kycTier on
            approval, so the form appears without a reload. */}
        {kycTier < 2 && identityCheckAvailable ? (
          <>
            <Txt style={type.inst}>
              Partners handle other people’s money, so we verify who you are first. It is the same quick
              identity check that unlocks higher limits.
            </Txt>
            <Spacer />
            <Btn label="Verify your identity" variant="ink" onPress={() => router.push('/identity')} />
          </>
        ) : (
          <>
            <Txt style={[type.kvKey, { marginBottom: 8 }]}>Name</Txt>
            <SearchBar placeholder="Your name, or what you trade as" value={name} onChangeText={setName} />

            <Txt style={[type.kvKey, { marginTop: 18, marginBottom: 8 }]}>Contact number</Txt>
            <SearchBar placeholder="+91 98765 43210" value={phone} onChangeText={setPhone} />
            <Txt style={[type.rowTime, { marginTop: 6 }]}>
              How we reach you if a payout goes wrong. Not shown to anyone you pay.
            </Txt>

            <Txt style={[type.inst, { marginTop: 18 }]}>Payouts settle to your fpay balance.</Txt>

            {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 14 }]}>{err}</Txt> : null}

            <Spacer />
            <Btn
              label={busy ? 'Submitting…' : 'Continue'}
              variant="ink"
              disabled={busy || name.trim().length < 2 || !walletAddress || !/^\+[1-9]\d{6,14}$/.test(phone.replace(/\s/g, ''))}
              onPress={() => void submit()}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  safe: { backgroundColor: colors.canvas },
  scroll: {
    paddingTop: 14,
    paddingLeft: GUTTER,
    paddingRight: GUTTER,
    paddingBottom: 28,
  },
} satisfies Record<string, CSSProperties>;
