// Txt — Text with font-scaling disabled by default so money figures and layout
// stay pixel-accurate to the design regardless of the device's text-size setting.
import { Text, type TextProps } from 'react-native';

export function Txt({ allowFontScaling = false, ...rest }: TextProps) {
  return <Text allowFontScaling={allowFontScaling} {...rest} />;
}
