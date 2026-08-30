'use client';

// QrCode.tsx — one QR, rendered as SVG. qrcode.react on web, react-native-qrcode-svg on native.
import { colors } from '@fpay/ui';
import { QRCodeSVG } from 'qrcode.react';

export function QrCode({ value, size }: { value: string; size: number }) {
  return <QRCodeSVG value={value} size={size} bgColor="#FFFFFF" fgColor={colors.ink} level="M" />;
}
