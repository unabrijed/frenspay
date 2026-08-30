'use client';

// Receive.tsx — show my QR so a friend can scan it and pay me. Encodes `pay:<handle>`, which
// the universal scanner (@fpay/shared payTarget.ts) decodes back to a handle → resolve → send. A Share button
// lets me invite someone who isn't on Pay yet.
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { Btn, colors, Grab, Icons, SheetBody, SheetHeader, Txt, type, View } from '@fpay/ui';
import { QrCode } from '../components/QrCode';
import { platform } from '../platform';
import { usePayStore } from '../store';

export function Receive() {
  const close = usePayStore((s) => s.close);
  const handle = usePayStore((s) => s.handle);
  const value = handle ? `pay:${handle}` : '';
  const [copied, setCopied] = useState(false);

  const onShare = async () => {
    const origin = platform().origin();
    const text = `Pay me on fpay. My handle is ${handle}`;
    try {
      const how = await platform().share({ title: 'Pay me on fpay', text, url: origin || undefined });
      if (how === 'copied') {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* user dismissed the share sheet */
    }
  };

  return (
    <>
      <Grab />
      <SheetHeader title="Receive money" onClose={close} />
      <SheetBody style={{ alignItems: 'center' }}>
        <Txt style={[type.lead, { textAlign: 'center', marginBottom: 18 }]}>Scan this to pay me on fpay.</Txt>
        <View style={styles.qrCard}>
          {value ? (
            <QrCode value={value} size={208} />
          ) : (
            <Icons.QrBig size={64} color={colors.muted} />
          )}
        </View>
        <Txt style={[type.handle, { marginTop: 20 }]}>{handle || '—'}</Txt>
        {/* Disabled on the same condition that suppresses the QR. Sharing without a handle sent the
            dangling sentence "Pay me on fpay. My handle is" and a bare origin URL — an invite that
            names nobody, from the one screen whose entire job is to name you. */}
        <Btn
          label={copied ? 'Copied' : 'Share / invite'}
          variant="secondary"
          disabled={!handle}
          onPress={onShare}
          style={{ marginTop: 22, alignSelf: 'stretch' }}
        />
      </SheetBody>
    </>
  );
}

const styles = {
  qrCard: {
    padding: 18,
    backgroundColor: colors.white,
    borderRadius: 24,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
} satisfies Record<string, CSSProperties>;
