'use client';

// pay.tsx — the signature pay flow sheets: Scan → Amount → Review → Success / Declined.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

import { Icons } from '@/components/icons';
import { RateLock } from '@/components/RateLock';
import { ResultBlock } from '@/components/ResultBlock';
import { Btn, TextLink } from '@/components/ui/Button';
import { Keypad } from '@/components/ui/Keypad';
import { Grab, KV, SheetBody, SheetHeader, Spacer } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { inrRaw, RATE, usd } from '@/lib/money';
import { colors, fonts, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

// Camera QR scanner — browser-only (getUserMedia + wasm decode), so load it client-side only.
const Scanner = dynamic(() => import('@yudiel/react-qr-scanner').then((m) => m.Scanner), { ssr: false });

export function Scan() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const handleScan = usePayStore((s) => s.handleScan);
  const error = usePayStore((s) => s.error);
  const [handled, setHandled] = useState(false);
  const [denied, setDenied] = useState(false);

  // Fresh sheet → clear any stale scan error from a previous attempt.
  useEffect(() => {
    usePayStore.setState({ error: null });
  }, []);

  // The scanner fires repeatedly; gate to one dispatch, then re-arm so a different QR can be tried.
  const onScan = (codes: Array<{ rawValue: string }>) => {
    if (handled) return;
    const raw = codes[0]?.rawValue;
    if (!raw) return;
    setHandled(true);
    void handleScan(raw);
    setTimeout(() => setHandled(false), 1500);
  };

  return (
    <>
      <Grab />
      <SheetHeader title="Scan to pay a friend" onClose={close} />
      <SheetBody>
        <View style={styles.viewport}>
          {denied ? (
            <View style={styles.viewportFallback}>
              <Icons.QrBig size={44} color="rgba(255,255,255,0.5)" />
            </View>
          ) : (
            <Scanner
              onScan={onScan}
              onError={() => setDenied(true)}
              formats={['qr_code']}
              constraints={{ facingMode: 'environment' }}
              scanDelay={400}
              paused={handled}
              components={{ finder: false }}
              styles={{ container: { width: '100%', height: '100%' }, video: { width: '100%', height: '100%', objectFit: 'cover' } }}
            />
          )}
          {CORNER_GUIDES}
        </View>
        {error ? (
          <Txt style={[type.lead, styles.scanError]}>{error}</Txt>
        ) : (
          <Txt style={[type.lead, styles.scanLead]}>Point at a friend&apos;s Pay QR.</Txt>
        )}
        <Pressable onPress={() => open('receive')} style={({ pressed }) => [styles.myqr, pressed ? { opacity: 0.7 } : null]}>
          <Icons.Qr size={16} color={colors.accent} />
          <Txt style={{ ...fonts.body500, fontSize: 14.5, color: colors.accent }}>Show my QR</Txt>
        </Pressable>
        {denied ? (
          <Txt style={[type.lead, { textAlign: 'center', marginTop: 8 }]}>
            Camera unavailable. Use Send and enter a @handle to pay a friend.
          </Txt>
        ) : null}
      </SheetBody>
    </>
  );
}

// Hoisted once (no per-render allocation) — the violet viewfinder corner ticks over the camera.
const cornerBase: CSSProperties = { position: 'absolute', width: 30, height: 30 };
const CORNER_GUIDES = (
  <>
    <View style={{ ...cornerBase, top: 26, left: 26, borderTopWidth: 3, borderLeftWidth: 3, borderStyle: 'solid', borderColor: colors.accent, borderTopLeftRadius: 8 }} />
    <View style={{ ...cornerBase, top: 26, right: 26, borderTopWidth: 3, borderRightWidth: 3, borderStyle: 'solid', borderColor: colors.accent, borderTopRightRadius: 8 }} />
    <View style={{ ...cornerBase, bottom: 26, left: 26, borderBottomWidth: 3, borderLeftWidth: 3, borderStyle: 'solid', borderColor: colors.accent, borderBottomLeftRadius: 8 }} />
    <View style={{ ...cornerBase, bottom: 26, right: 26, borderBottomWidth: 3, borderRightWidth: 3, borderStyle: 'solid', borderColor: colors.accent, borderBottomRightRadius: 8 }} />
  </>
);

export function Amount() {
  const close = usePayStore((s) => s.close);
  const getQuote = usePayStore((s) => s.getQuote);
  const busy = usePayStore((s) => s.busy);
  const merchant = usePayStore((s) => s.merchant);
  const scannedRupees = usePayStore((s) => s.scannedRupees);
  // Dynamic UPI QRs carry the amount → seed it; static QRs (am absent) start blank-ish for entry.
  const [d, setD] = useState(() => (scannedRupees > 0 ? String(scannedRupees) : '500'));
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
        <Btn label="Get quote" variant="ink" disabled={rupees <= 0 || busy} onPress={() => void getQuote(rupees)} />
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

const styles = {
  viewport: {
    position: 'relative',
    height: 250,
    backgroundColor: '#101316',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  viewportFallback: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', opacity: 0.6 },
  scanLead: { textAlign: 'center', marginBottom: 14 },
  scanError: { textAlign: 'center', marginBottom: 14, color: colors.danger },
  myqr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingTop: 2, paddingBottom: 14 },
  amountbig: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  cta: { gap: 13, alignItems: 'center' },
  bold: { ...fonts.mono500, color: colors.ink },
} satisfies Record<string, CSSProperties>;
