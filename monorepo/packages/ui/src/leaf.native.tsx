// leaf.native.tsx — RN twins of the three per-platform primitives in leaf.tsx. Same prop shapes.
import { useState } from 'react';
import { Image, TextInput, type KeyboardTypeOptions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { type St, sx } from './rn';
import { colors } from './theme';
import { type InputProps, type KeyboardType, MARK_LINK, type MarkProps, flagUrl } from './leaf.types';

export type { InputProps, KeyboardType, LogoState, MarkProps } from './leaf.types';
export { MARK_LINK, flagUrl } from './leaf.types';

const KEYBOARD: Record<KeyboardType, KeyboardTypeOptions> = {
  default: 'default',
  numeric: 'number-pad',
  decimal: 'decimal-pad',
  email: 'email-address',
  tel: 'phone-pad',
};

export function Input({ value, onChangeText, placeholder, autoFocus, keyboardType = 'default', maxLength, autoComplete, onSubmit, style }: InputProps) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      autoFocus={autoFocus}
      keyboardType={KEYBOARD[keyboardType]}
      maxLength={maxLength}
      autoComplete={autoComplete === 'one-time-code' ? 'sms-otp' : autoComplete}
      textContentType={autoComplete === 'one-time-code' ? 'oneTimeCode' : undefined}
      autoCapitalize="none"
      autoCorrect={false}
      allowFontScaling={false}
      style={[{ padding: 0, color: colors.ink }, sx(style as St[])]}
    />
  );
}

// The mark, static: no bead, no entrance. The web keyframes live in a stylesheet; on RN the
// equivalent is a reanimated loop nobody has asked for yet. ponytail: add it when a pending
// button on the phone looks dead without it.
export function Mark({ size, color = colors.canvas }: MarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <Path d={MARK_LINK} stroke={color} strokeWidth={48} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={66} cy={74} r={31} fill={color} />
      <Circle cx={190} cy={74} r={31} fill={color} />
    </Svg>
  );
}

export function Flag({ iso, size = 40 }: { iso: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      source={{ uri: flagUrl(iso) }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      onError={() => setFailed(true)}
    />
  );
}
