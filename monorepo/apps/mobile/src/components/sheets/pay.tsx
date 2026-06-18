// pay.tsx — the signature pay flow sheets: Scan → Amount → Review → Success / Declined.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icons } from '@/components/icons';
import { RateLock } from '@/components/RateLock';
import { ResultBlock } from '@/components/ResultBlock';
import { Btn, TextLink } from '@/components/ui/Button';
import { Keypad } from '@/components/ui/Keypad';
import {
  Grab,
  KV,
  List,
  Row,
  RowIcon,
  RowMeta,
  SheetBody,
  SheetHeader,
  Spacer,
} from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { inrRaw, RATE, usd } from '@/lib/money';
import { colors, fonts, type } from '@/lib/theme';
import { DEMO_MERCHANTS } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

export function Scan() {
  const close = usePayStore((s) => s.close);
  const payMerchant = usePayStore((s) => s.payMerchant);
  return (
    <>
      <Grab />
      <SheetHeader title="Scan and pay" onClose={close} />
      <SheetBody>
        <View style={styles.viewport}>
          <CornerGuides />
          <View style={{ opacity: 0.5 }}>
            <Icons.QrBig size={54} color="rgba(255,255,255,0.55)" />
          </View>
        </View>
        <Txt style={[type.lead, styles.scanLead]}>Point at any UPI QR.</Txt>
        <List>
          {DEMO_MERCHANTS.map((m) => (
            <Row key={m.name} onPress={() => payMerchant(m)}>
              <RowIcon accent>
                <Icons.Qr size={18} color={colors.accent} />
              </RowIcon>
              <RowMeta>
                <Txt style={type.rowName}>{m.name}</Txt>
              </RowMeta>
              <Icons.Chevron size={18} color={colors.muted} />
            </Row>
          ))}
        </List>
      </SheetBody>
    </>
  );
}

function CornerGuides() {
  const base = { position: 'absolute', width: 30, height: 30 } as const;
  return (
    <>
      <View style={[base, { top: 26, left: 26, borderTopWidth: 3, borderLeftWidth: 3, borderColor: colors.accent, borderTopLeftRadius: 8 }]} />
      <View style={[base, { top: 26, right: 26, borderTopWidth: 3, borderRightWidth: 3, borderColor: colors.accent, borderTopRightRadius: 8 }]} />
      <View style={[base, { bottom: 26, left: 26, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: colors.accent, borderBottomLeftRadius: 8 }]} />
      <View style={[base, { bottom: 26, right: 26, borderBottomWidth: 3, borderRightWidth: 3, borderColor: colors.accent, borderBottomRightRadius: 8 }]} />
    </>
  );
}

export function Amount() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const setPayRupees = usePayStore((s) => s.setPayRupees);
  const merchant = usePayStore((s) => s.merchant);
  const [d, setD] = useState('500');
  const press = (k: string) => {
    if (k === '⌫') setD((s) => s.slice(0, -1));
    else if (d.length < 6) setD((s) => (s === '0' ? '' : s) + k);
  };
  const rupees = parseInt(d || '0', 10);
  const u = rupees / RATE;
  return (
    <>
      <Grab />
      <SheetHeader eyebrow="Paying" title={merchant.name} onClose={close} />
      <SheetBody>
        <View style={styles.amountbig}>
          <Txt style={[type.bigAmount, { color: colors.ink }]}>{inrRaw(rupees)}</Txt>
          <Txt style={type.conv}>{usd(u)} from your balance</Txt>
        </View>
        <Keypad onPress={press} />
        <Btn
          label="Review"
          variant="ink"
          disabled={rupees <= 0}
          onPress={() => {
            setPayRupees(rupees);
            open('review');
          }}
        />
      </SheetBody>
    </>
  );
}

export function Review() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const doPay = usePayStore((s) => s.doPay);
  const merchant = usePayStore((s) => s.merchant);
  const payR = usePayStore((s) => s.payRupees);
  const bal = usePayStore((s) => s.balanceUSD);
  const u = payR / RATE;
  const after = bal - u;
  const ok = after >= 0;
  return (
    <>
      <Grab />
      <SheetHeader title="Review payment" onClose={close} />
      <SheetBody>
        <Txt style={[type.lead, { marginBottom: 4 }]}>
          Paying {merchant.name}. The rate is locked for this payment.
        </Txt>
        <View style={{ marginTop: 22 }}>
          <RateLock payUsd={u} getR={payR} />
        </View>
        <View style={{ marginTop: 12 }}>
          <KV k="Balance after" v={ok ? usd(after) : usd(bal)} />
        </View>
        <Spacer />
        <View style={styles.cta}>
          <Btn label={`Pay ${inrRaw(payR)}`} onPress={() => doPay(ok)} />
          <TextLink label="Back" onPress={() => open('amount')} />
        </View>
      </SheetBody>
    </>
  );
}

export function Success() {
  const close = usePayStore((s) => s.close);
  const finishPay = usePayStore((s) => s.finishPay);
  const payR = usePayStore((s) => s.payRupees);
  const u = payR / RATE;
  return (
    <>
      <Grab />
      <SheetHeader title="Paid" onClose={close} />
      <SheetBody>
        <ResultBlock
          kind="ok"
          icon={<Icons.Check size={30} color={colors.accent} />}
          headline={`${inrRaw(payR)} paid`}
          inst="Paid instantly, from your dollars"
        />
        <View style={{ marginTop: 22 }}>
          <RateLock payUsd={u} getR={payR} />
        </View>
        <Spacer />
        <View style={styles.cta}>
          <Btn label="Done" variant="ink" onPress={finishPay} />
        </View>
      </SheetBody>
    </>
  );
}

export function Declined() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const payR = usePayStore((s) => s.payRupees);
  const bal = usePayStore((s) => s.balanceUSD);
  const need = payR / RATE;
  return (
    <>
      <Grab />
      <SheetHeader title="Payment not sent" onClose={close} />
      <SheetBody>
        <ResultBlock kind="no" icon={<Icons.XBig size={28} color={colors.muted} />} headline={`${inrRaw(payR)} not paid`} />
        <Txt style={[type.reassure, { textAlign: 'center', marginTop: 22 }]}>
          Your balance did not change.{'\n'}You need <Txt style={styles.bold}>{usd(need)}</Txt> but have{' '}
          <Txt style={styles.bold}>{usd(bal)}</Txt>.
        </Txt>
        <Spacer />
        <View style={styles.cta}>
          <Btn label="Add money" onPress={() => open('add')} />
          <TextLink label="Cancel" onPress={close} />
        </View>
      </SheetBody>
    </>
  );
}

const styles = StyleSheet.create({
  viewport: {
    height: 250,
    backgroundColor: '#101316',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  scanLead: { textAlign: 'center', marginBottom: 14 },
  amountbig: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  cta: { gap: 13, alignItems: 'center' },
  bold: { fontFamily: fonts.mono500, color: colors.ink },
});
