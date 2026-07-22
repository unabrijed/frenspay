'use client';

// sendAddress.tsx — direct send to a raw wallet address (docs/16): amount → confirm → send.
// External sends get the one deliberate confirm step in the app (irreversible destination),
// plus the "which network" sheet for EVM-family addresses we can't execute on yet.
// Copy rule: dollars only, never token names; network names are the only crypto surface.
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { SUPPORTED_NETWORKS, truncateAddress } from '@fpay/shared';

import { Icons } from '@/components/icons';
import { Btn, TextLink } from '@/components/ui/Button';
import { Keypad } from '@/components/ui/Keypad';
import { Grab, List, Row, RowMeta, SheetBody, SheetHeader, Spacer } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { View } from '@/components/ui/rn';
import { inr } from '@/lib/money';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

function WalletBadge() {
  return (
    <View style={styles.walletBadge}>
      <Icons.Wallet size={22} color={colors.accent} />
    </View>
  );
}

export function SendAddressAmount() {
  const close = usePayStore((s) => s.close);
  const setExternalAmount = usePayStore((s) => s.setExternalAmount);
  const ext = usePayStore((s) => s.externalSend);
  const bal = usePayStore((s) => s.balanceUSD);
  const [d, setD] = useState('');
  const press = (k: string) => {
    if (k === '⌫') setD((s) => s.slice(0, -1));
    else if (k === '00') setD((s) => (s === '0' || s === '' ? s : s + '00'));
    else if (d.length < 5) setD((s) => (s === '0' ? '' : s) + k);
  };
  const u = parseInt(d || '0', 10);
  const ok = u > 0 && u <= bal && !!ext;
  return (
    <>
      <Grab />
      <SheetHeader title="Send money" onClose={close} />
      <SheetBody>
        <View style={styles.payee}>
          <WalletBadge />
          <Txt style={[type.sub, { marginTop: 8 }]}>Sending to wallet</Txt>
          <Txt style={[type.payeeWho, styles.mono]}>{truncateAddress(ext?.address ?? '')}</Txt>
        </View>
        <View style={styles.amountWrap}>
          <View style={styles.amountRow}>
            <Txt style={[type.bigAmount, styles.dollar]}>$</Txt>
            <Txt style={[type.bigAmount, { color: colors.ink }]}>{u}</Txt>
          </View>
          <View style={styles.convPill}>
            <Icons.LockCheck size={14} color={colors.secondary} />
            <Txt style={[type.sub, { color: colors.muted }]}>≈ {inr(u)} · rate locked</Txt>
          </View>
        </View>
        <Keypad onPress={press} />
        <Btn label="Review" disabled={!ok} onPress={() => setExternalAmount(u)} />
      </SheetBody>
    </>
  );
}

export function SendAddressConfirm() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const doSendExternal = usePayStore((s) => s.doSendExternal);
  const ext = usePayStore((s) => s.externalSend);
  const busy = usePayStore((s) => s.busy);
  if (!ext) return null;
  return (
    <>
      <Grab />
      <SheetHeader title="Check and send" onClose={close} />
      <SheetBody>
        <View style={styles.payee}>
          <WalletBadge />
          <Txt style={[type.bigAmount, { color: colors.ink, marginTop: 10 }]}>${ext.amountUsd}</Txt>
          <Txt style={[type.sub, { color: colors.muted }]}>≈ {inr(ext.amountUsd)}</Txt>
        </View>
        <View style={styles.detailCard}>
          <View style={styles.kvRow}>
            <Txt style={[type.tierTag, { color: colors.muted }]}>TO WALLET</Txt>
            <Txt style={[type.rowName, styles.mono]}>{truncateAddress(ext.address)}</Txt>
          </View>
          <View style={styles.hr} />
          <View style={styles.kvRow}>
            <Txt style={[type.tierTag, { color: colors.muted }]}>NETWORK</Txt>
            <View style={styles.netPill}>
              <Txt style={[type.sub, { color: colors.ink }]}>Solana</Txt>
            </View>
          </View>
        </View>
        <Txt style={[type.rowTime, styles.warn]}>
          Double-check the address — money sent to the wrong place can’t be recovered.
        </Txt>
        <Spacer />
        <View style={styles.cta}>
          <Btn label={`Send $${ext.amountUsd}`} disabled={busy} onPress={() => void doSendExternal()} />
          <TextLink label="Back" onPress={() => open('sendAddressAmount')} />
        </View>
      </SheetBody>
    </>
  );
}

export function SendNetwork() {
  const close = usePayStore((s) => s.close);
  const comingSoon = SUPPORTED_NETWORKS.filter((n) => n.status === 'coming_soon');
  return (
    <>
      <Grab />
      <SheetHeader title="Which network?" onClose={close} />
      {/* 12 coming-soon rows — the list must scroll inside the sheet's max height. */}
      <SheetBody style={{ overflowY: 'auto' }}>
        <Txt style={[type.lead, { marginBottom: 12 }]}>
          That address lives on one of these networks. fpay sends on Solana today — these are coming soon.
        </Txt>
        <List>
          {comingSoon.map((n) => (
            <Row key={n.id}>
              <RowMeta>
                <Txt style={[type.rowName, { color: colors.muted }]}>{n.displayName}</Txt>
              </RowMeta>
              <View style={styles.soonPill}>
                <Txt style={[type.rowTime, { color: colors.muted }]}>Coming soon</Txt>
              </View>
            </Row>
          ))}
        </List>
        <Spacer />
        <View style={styles.cta}>
          <Btn label="OK" variant="ink" onPress={close} />
        </View>
      </SheetBody>
    </>
  );
}

const styles = {
  payee: { alignItems: 'center', gap: 2, paddingTop: 6, paddingBottom: 6 },
  walletBadge: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  amountWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline' },
  dollar: { color: colors.tertiary, fontSize: 34, marginRight: 2 },
  convPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceLow,
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 14,
    paddingTop: 7,
    paddingBottom: 7,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.outlineVariant,
  },
  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.outlineVariant,
    boxShadow: '0 4px 20px rgba(74,70,67,0.05)',
    padding: 16,
    marginTop: 16,
  },
  kvRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, paddingBottom: 4 },
  hr: { height: 1, backgroundColor: colors.hair, marginTop: 6, marginBottom: 6 },
  netPill: {
    backgroundColor: colors.surfaceLow,
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 5,
    paddingBottom: 5,
  },
  soonPill: {
    backgroundColor: colors.surfaceLow,
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 4,
    paddingBottom: 4,
  },
  warn: { textAlign: 'center', marginTop: 14, color: colors.muted },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
