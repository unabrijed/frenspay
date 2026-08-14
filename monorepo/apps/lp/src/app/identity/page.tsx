'use client';

// /identity — the tier-2 identity check that gates applying.
//
// In the wallet app this was a bottom sheet; here it is a route. Same vendor, same endpoint, same
// return-and-poll: the console has no sheet layer, and this is the only flow that needed one.
import { useRouter, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { BackButton } from '@fpay/ui/BackButton';
import { Btn } from '@fpay/ui/Button';
import { Spacer } from '@fpay/ui/primitives';
import { View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';

import { friendlyError } from '@/lib/errors';
import { req } from '@/services/api';
import { useLpStore } from '@/store/useLpStore';
import { colors, GUTTER, type } from '@fpay/ui/theme';

export default function Identity() {
  const router = useRouter();
  const params = useSearchParams();
  const kycTier = useLpStore((s) => s.kycTier);
  const kycStatus = useLpStore((s) => s.kycStatus);
  const pollKyc = useLpStore((s) => s.pollKyc);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  // The vendor redirects back here with its own query params. Their presence is the signal that a
  // check just finished; the tier itself lands via the vendor's webhook and our poller, which can
  // trail the user's return by a few seconds — hence the poll rather than a single read.
  const returned = params.has('verificationSessionId');
  useEffect(() => {
    if (!returned || kycTier >= 2) return;
    setWaiting(true);
    void pollKyc().finally(() => setWaiting(false));
  }, [returned]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      // The callback carries no query of our own, so the vendor's params can never collide.
      const { url } = await req<{ url?: string; tier?: number }>('/kyc/verify', {
        method: 'POST',
        body: JSON.stringify({ returnUrl: `${window.location.origin}/identity` }),
      });
      // The dev simulator upgrades inline and returns no URL — reload state instead of redirecting.
      if (!url) {
        await useLpStore.getState().load();
        router.push('/apply');
        return;
      }
      window.location.assign(url);
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  };

  const done = kycTier >= 2;
  const pending = kycStatus === 'pending' || kycStatus === 'in_review' || waiting;

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push('/apply')} />
      </View>
      <View style={styles.scroll}>
        <Txt style={type.handle}>{done ? 'You’re verified' : 'Verify your identity'}</Txt>
        <Txt style={[type.lead, { marginTop: 10 }]}>
          {done
            ? 'Nothing else needed here — you can apply now.'
            : 'You’ll be handling other people’s money, so we check who you are first. Passport or ID, about two minutes.'}
        </Txt>

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}

        <Spacer />
        {done ? (
          <Btn label="Continue" variant="ink" onPress={() => router.push('/apply')} />
        ) : (
          <Btn
            label={pending ? 'Checking your verification…' : busy ? 'Starting…' : 'Start'}
            variant="ink"
            disabled={busy || pending}
            onPress={() => void start()}
          />
        )}
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
