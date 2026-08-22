// QrCode.native.tsx — see QrCode.tsx.
import { colors } from '@fpay/ui';
import QRCode from 'react-native-qrcode-svg';

export function QrCode({ value, size }: { value: string; size: number }) {
  return <QRCode value={value} size={size} backgroundColor="#FFFFFF" color={colors.ink} ecl="M" />;
}
