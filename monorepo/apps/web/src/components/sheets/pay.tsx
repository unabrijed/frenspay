'use client';

// pay.tsx — the merchant pay entry sheets: Scan → Amount. Amount runs the REAL order lifecycle
// (getQuote → Quote sheet → confirmOrder/escrow → OrderTracking); there is no client-side settlement.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

import { Icons } from '@/components/icons';
import { Btn } from '@/components/ui/Button';
import { Keypad } from '@/components/ui/Keypad';
import { Grab, SearchBar, SheetBody, SheetHeader } from '@/components/ui/primitives';
import { Pressable, View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { INR_DECIMALS } from '@fpay/shared';

import { inrRaw, usd } from '@/lib/money';
import { colors, fonts, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

// Camera QR scanner — browser-only (getUserMedia + wasm decode), so load it client-side only.
const Scanner = dynamic(() => import('@yudiel/react-qr-scanner').then((m) => m.Scanner), { ssr: false });

// Why a camera request can fail, normalized from the scanner lib's error (which may expose `kind`)
// or a raw getUserMedia DOMException (`name`). Drives an accurate fallback message + Try-again.
type CamErr = 'blocked' | 'no-camera' | 'insecure' | 'other';

function classifyCamError(e: unknown): CamErr {
  // A non-secure origin (e.g. testing on a phone over http://<LAN-ip>) disables getUserMedia entirely.
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure';
  const kind = (e as { kind?: string } | null)?.kind;
  const name = (e as { name?: string } | null)?.name;
  if (kind === 'insecure-context') return 'insecure';
  if (kind === 'no-camera' || name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera';
  if (kind === 'permission-denied' || name === 'NotAllowedError' || name === 'SecurityError') return 'blocked';
  return 'other';
}

const CAM_MESSAGES: Record<CamErr, string> = {
  // A hard "Block" can't be re-prompted from JS — the browser only re-asks after the user re-allows.
  blocked: 'Camera is blocked. Allow it from the camera icon in your address bar, then tap Try again.',
  'no-camera': 'No camera found. Use Send and enter a @handle to pay a friend.',
  insecure: 'The camera needs a secure connection. Open the app over localhost or an https link.',
  other: "Couldn't start the camera. Tap Try again, or use Send to enter a @handle.",
};

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
  const onScan = (codes: Array<{ rawValue: string }>) => {
    if (handled) return;
    const raw = codes[0]?.rawValue;
    if (!raw) return;
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
            <Scanner
              key={attempt}
              onScan={onScan}
              onError={(e) => setCamErr(classifyCamError(e))}
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
          <Txt style={[type.lead, styles.scanLead]}>
            {camErr ? CAM_MESSAGES[camErr] : 'Point at any UPI QR, or a friend’s fpay code.'}
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
            <SearchBar placeholder="Or enter a UPI ID" value={typed} onChangeText={setTyped} />
          </View>
          <Btn label="Pay" disabled={!typed.trim()} onPress={() => void handleScan(typed.trim())} />
        </View>
        <Pressable onPress={() => open('receive')} style={({ pressed }) => [styles.myqr, pressed ? { opacity: 0.7 } : null]}>
          <Icons.Qr size={16} color={colors.accent} />
          <Txt style={{ ...fonts.body500, fontSize: 14.5, color: colors.accent }}>Show my QR</Txt>
        </Pressable>
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
  const payee = usePayStore((s) => s.payee);
  const scannedRupees = usePayStore((s) => s.scannedRupees);
  const fxRate = usePayStore((s) => s.fxRate);
  // Dynamic UPI QRs carry the amount → seed it; static QRs (am absent) start blank-ish for entry.
  const [d, setD] = useState(() => (scannedRupees > 0 ? String(scannedRupees) : '500'));
  const press = (k: string) => {
    if (k === '⌫') return setD((s) => s.slice(0, -1));
    setD((s) => {
      const next = (s === '0' ? '' : s) + k;
      const [whole, paise] = next.split('.');
      // Reject the keystroke rather than truncate. A seeded QR decimal is the only way to reach a
      // fraction at all — the keypad has no '.' key — so manual entry stays whole-rupee as designed,
      // while a scanned ₹249.50 keeps its paise instead of being read back as ₹249.
      if (whole.length > 6 || (paise?.length ?? 0) > INR_DECIMALS) return s;
      return next;
    });
  };
  // Number(), not parseInt(): parseInt("249.5") is 249. Tolerates a mid-edit trailing '.'.
  const rupees = Number(d) || 0;
  const u = rupees / fxRate;
  return (
    <>
      <Grab />
      <SheetHeader eyebrow="Paying" title={payee.name} onClose={close} />
      <SheetBody>
        <View style={styles.amountbig}>
          <Txt style={[type.bigAmount, { color: colors.ink }]}>{inrRaw(rupees)}</Txt>
          <Txt style={type.conv}>{usd(u)} from your balance</Txt>
        </View>
        <Keypad onPress={press} />
        <Btn label={busy ? 'Getting quote…' : 'Get quote'} variant="ink" disabled={rupees <= 0 || busy} onPress={() => void getQuote(rupees)} />
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
} satisfies Record<string, CSSProperties>;
