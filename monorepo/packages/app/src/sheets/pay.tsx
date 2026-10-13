'use client';

// pay.tsx — the scan-and-pay entry sheets: Scan → Amount. Amount is the whole pre-pay screen, the
// way it is in any everyday payments app: the quote is polled live under the amount and the one
// action is Pay (confirmOrder → escrow funding → OrderTracking); there is no client-side settlement.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { Btn, colors, fonts, Grab, Icons, Keypad, Pressable, SearchBar, SheetBody, SheetHeader, TextLink, Txt, type, View } from '@fpay/ui';
import { fiatDecimals, fiatRaw, usd } from '@fpay/shared';

import { usePayStore } from '../store';

import { CAM_MESSAGES, type CamErr, Scanner } from '../components/Scanner';

export function Scan() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const handleScan = usePayStore((s) => s.handleScan);
  const error = usePayStore((s) => s.error);
  const [handled, setHandled] = useState(false);
  const [camErr, setCamErr] = useState<CamErr | null>(null);
  const [typed, setTyped] = useState('');
  // Bumped on Try-again; used as the Scanner's `key` to force a fresh mount → a fresh getUserMedia
  // (re-prompts for the not-yet-decided state, and recovers instantly if the user just un-blocked).
  const [attempt, setAttempt] = useState(0);

  // Fresh sheet → clear any stale scan error from a previous attempt.
  useEffect(() => {
    usePayStore.setState({ error: null });
  }, []);

  // The scanner fires repeatedly; gate to one dispatch, then re-arm so a different QR can be tried.
  const onScan = (raw: string) => {
    if (handled || !raw) return;
    setHandled(true);
    void handleScan(raw);
    setTimeout(() => setHandled(false), 1500);
  };

  const retry = () => {
    setCamErr(null);
    setAttempt((a) => a + 1);
  };

  return (
    <>
      <Grab />
      <SheetHeader title="Scan to pay" onClose={close} />
      <SheetBody>
        <View style={styles.viewport}>
          {camErr ? (
            <View style={styles.viewportFallback}>
              <Icons.QrBig size={44} color="rgba(255,255,255,0.5)" />
            </View>
          ) : (
            <Scanner key={attempt} onScan={onScan} onError={setCamErr} paused={handled} />
          )}
          {CORNER_GUIDES}
        </View>
        {error ? (
          <Txt style={[type.lead, styles.scanError]}>{error}</Txt>
        ) : (
          <Txt style={[type.lead, styles.scanLead]}>
            {camErr ? CAM_MESSAGES[camErr] : 'Scan a supported payment QR or a friend’s fpay code.'}
          </Txt>
        )}
        {camErr ? (
          <View style={styles.retryRow}>
            <Btn label="Try again" onPress={retry} />
          </View>
        ) : null}
        {/* Typing the ID beats scanning whenever the QR is on a screen you're holding, printed
            badly, or simply not in front of you. Same parser as the camera path. */}
        <View style={styles.manual}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <SearchBar placeholder="Or paste a payment link or username" value={typed} onChangeText={setTyped} />
          </View>
          <Btn label="Pay" disabled={!typed.trim()} onPress={() => void handleScan(typed.trim())} />
        </View>
        <Pressable onPress={() => open('receive')} style={({ pressed }) => [styles.myqr, pressed ? { opacity: 0.7 } : null]}>
          <Icons.Qr size={16} color={colors.accent} />
          <Txt style={{ ...fonts.body500, fontSize: 14.5, color: colors.accent }}>Show my QR</Txt>
        </Pressable>
        <TextLink label="Pending payments" onPress={() => { usePayStore.setState({ merchantLink: null }); open('merchantPayment'); }} />
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

// Whole-digit keypad cap per currency — the same real-world ceiling (~$5–11k) lands at different
// digit counts when a coffee costs ₹300 in one corridor and Rp 30,000 in the other.
const WHOLE_DIGITS: Record<string, number> = { INR: 6, IDR: 8 };

/** "30–90 sec" / "1–3 min" — the quote's ETA, shown before Pay and again while it runs. */
export const fmtEta = (minSecs: number, maxSecs: number): string =>
  maxSecs < 90 ? `${minSecs}–${maxSecs} sec` : `${Math.round(minSecs / 60)}–${Math.round(maxSecs / 60)} min`;

export function Amount() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const getQuote = usePayStore((s) => s.getQuote);
  const refreshQuote = usePayStore((s) => s.refreshQuote);
  const confirmOrder = usePayStore((s) => s.confirmOrder);
  const quote = usePayStore((s) => s.quote);
  const busy = usePayStore((s) => s.busy);
  const error = usePayStore((s) => s.error);
  const pendingPay = usePayStore((s) => s.pendingPay);
  const payee = usePayStore((s) => s.payee);
  const scannedRupees = usePayStore((s) => s.scannedRupees);
  const fxRates = usePayStore((s) => s.fxRates);
  const currency = payee.currency ?? 'INR';
  const rate = fxRates[currency];
  // Dynamic QRs carry the amount → seed it; static QRs (am absent) start blank-ish for entry.
  const [d, setD] = useState(() => (scannedRupees > 0 ? String(scannedRupees) : currency === 'IDR' ? '50000' : '500'));
  const press = (k: string) => {
    if (k === '⌫') return setD((s) => s.slice(0, -1));
    setD((s) => {
      const next = (s === '0' ? '' : s) + k;
      const [whole, frac] = next.split('.');
      // Reject the keystroke rather than truncate. A seeded QR decimal is the only way to reach a
      // fraction at all — the keypad has no '.' key — so manual entry stays whole-unit as designed,
      // while a scanned ₹249.50 keeps its paise instead of being read back as ₹249. (IDR has no
      // fraction at all — fiatDecimals is 0.)
      if (whole.length > (WHOLE_DIGITS[currency] ?? 6) || (frac?.length ?? 0) > fiatDecimals(currency)) return s;
      return next;
    });
  };
  // Number(), not parseInt(): parseInt("249.5") is 249. Tolerates a mid-edit trailing '.'.
  const amount = Number(d) || 0;
  const u = amount / rate;
  // The quote that prices THIS amount on THIS rail, or nothing. A quote for a previous amount is
  // not "a bit stale", it is for a different payment — Pay stays off until the current one lands.
  const live = quote && Number(quote.amountInr) === amount && quote.currency === currency ? quote : null;

  // Quote once the keys go quiet, not on every key: one call per pause, well inside the 30/min cap.
  // A failed quote leaves `quote` alone, so nothing here retries until the amount changes.
  useEffect(() => {
    if (amount <= 0 || live) return undefined;
    const t = setTimeout(() => void getQuote(amount), 400);
    return () => clearTimeout(t);
  }, [amount, live, getQuote]);
  // Keep the live quote fresh under the user — the store no-ops until near expiry, then swaps the
  // quote in place. The amount never changes; only the rate/USDC recalculate.
  useEffect(() => {
    const t = setInterval(() => void refreshQuote(), 1000);
    return () => clearInterval(t);
  }, [refreshQuote]);

  return (
    <>
      <Grab />
      <SheetHeader eyebrow="Paying" title={payee.name} onClose={close} />
      <SheetBody>
        {/* Where the money will actually land — the anti-wrong-send line every UPI app shows, the
            last chance to catch a bad scan. Named on the one screen there is before Pay. */}
        {payee.vpa ? <Txt style={styles.vpa}>{payee.vpa}</Txt> : null}
        <View style={styles.amountbig}>
          <Txt style={[type.bigAmount, { color: colors.ink }]}>{fiatRaw(amount, currency)}</Txt>
          {/* The mid-rate estimate until the live quote lands, then the all-in price. No fee line —
              the platform's cut lives inside the rate (the user only ever sees the conversion). */}
          <Txt style={type.conv}>
            {live ? `${usd(live.amountUsdc)} from your balance · $1 = ${fiatRaw(live.rate, currency)}` : `≈ ${usd(u)} from your balance`}
          </Txt>
          {/* The receiver will see N separate credits. Said here, before committing, because the
              person at the counter is the one who has to add them up — nothing about who sends them. */}
          {live ? (
            <Txt style={type.inst}>
              Arrives in {fmtEta(live.etaMinSecs, live.etaMaxSecs)}
              {live.parts ? ` · as ${live.parts} payments` : ''}
            </Txt>
          ) : null}
          {error ? <Txt style={[type.inst, styles.quoteError]}>{error}</Txt> : null}
          {pendingPay && error ? <TextLink label="Verify identity" onPress={() => open('verify')} /> : null}
        </View>
        <Keypad onPress={press} />
        <Btn
          label={busy ? 'Paying…' : `Pay ${fiatRaw(amount, currency)}`}
          variant="ink"
          pending={busy}
          disabled={!live || busy}
          onPress={() => void confirmOrder()}
        />
      </SheetBody>
    </>
  );
}

const styles = {
  viewport: {
    position: 'relative',
    width: '100%',
    maxWidth: 340,
    aspectRatio: 1, // square, aspect-locked → identical framing on phone + the 430px desktop column
    alignSelf: 'center',
    backgroundColor: '#101316',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  viewportFallback: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', opacity: 0.6 },
  manual: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 },
  scanLead: { textAlign: 'center', marginBottom: 14 },
  scanError: { textAlign: 'center', marginBottom: 14, color: colors.danger },
  retryRow: { alignItems: 'center', marginBottom: 14 },
  myqr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingTop: 2, paddingBottom: 14 },
  amountbig: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  vpa: { ...type.sub, textAlign: 'center' },
  quoteError: { textAlign: 'center', color: colors.danger },
} satisfies Record<string, CSSProperties>;
