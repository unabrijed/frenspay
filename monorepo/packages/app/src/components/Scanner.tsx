'use client';

// Scanner.tsx — the camera, web side: getUserMedia + zxing WASM via @yudiel/react-qr-scanner,
// loaded lazily so a session that never scans never downloads it. Scanner.native.tsx is the
// expo-camera twin; both hand the sheet one raw string per decode and a normalized failure kind.
import { lazy, Suspense } from 'react';

// Why a camera request can fail, normalized from the scanner lib's error (which may expose `kind`)
// or a raw getUserMedia DOMException (`name`). Drives an accurate fallback message + Try-again.
export type CamErr = 'blocked' | 'no-camera' | 'insecure' | 'other';

export const CAM_MESSAGES: Record<CamErr, string> = {
  // A hard "Block" can't be re-prompted from JS — the browser only re-asks after the user re-allows.
  blocked: 'Camera is blocked. Allow it from the camera icon in your address bar, then tap Try again.',
  'no-camera': 'No camera found. Use Send and enter a @handle to pay a friend.',
  insecure: 'The camera needs a secure connection. Open the app over localhost or an https link.',
  other: "Couldn't start the camera. Tap Try again, or use Send to enter a @handle.",
};

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

const Lib = lazy(() => import('@yudiel/react-qr-scanner').then((m) => ({ default: m.Scanner })));

export function Scanner({ onScan, onError, paused }: { onScan: (raw: string) => void; onError: (kind: CamErr) => void; paused: boolean }) {
  return (
    <Suspense fallback={null}>
      <Lib
        onScan={(codes) => codes[0]?.rawValue && onScan(codes[0].rawValue)}
        onError={(e) => onError(classifyCamError(e))}
        formats={['qr_code']}
        constraints={{ facingMode: 'environment' }}
        scanDelay={400}
        paused={paused}
        components={{ finder: false }}
        styles={{ container: { width: '100%', height: '100%' }, video: { width: '100%', height: '100%', objectFit: 'cover' } }}
      />
    </Suspense>
  );
}
