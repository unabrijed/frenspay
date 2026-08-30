// Scanner.native.tsx — the camera, RN side: expo-camera's CameraView with the QR decoder on.
// Same props as Scanner.tsx. Permission is asked on mount; a denial is the 'blocked' kind.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect } from 'react';

export type CamErr = 'blocked' | 'no-camera' | 'insecure' | 'other';

export const CAM_MESSAGES: Record<CamErr, string> = {
  blocked: 'Camera is blocked. Allow it for fpay in your phone’s Settings, then tap Try again.',
  'no-camera': 'No camera found. Use Send and enter a @handle to pay a friend.',
  insecure: "Couldn't start the camera. Tap Try again, or use Send to enter a @handle.",
  other: "Couldn't start the camera. Tap Try again, or use Send to enter a @handle.",
};

export function Scanner({ onScan, onError, paused }: { onScan: (raw: string) => void; onError: (kind: CamErr) => void; paused: boolean }) {
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (!permission) return;
    if (permission.granted) return;
    if (!permission.canAskAgain) {
      onError('blocked');
      return;
    }
    void requestPermission().then((r) => {
      if (!r.granted) onError('blocked');
    });
    // onError is a state setter from the sheet; re-asking on every render would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.granted, permission?.canAskAgain]);

  if (!permission?.granted) return null;
  return (
    <CameraView
      style={{ width: '100%', height: '100%' }}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={paused ? undefined : ({ data }) => data && onScan(data)}
      onMountError={() => onError('other')}
    />
  );
}
