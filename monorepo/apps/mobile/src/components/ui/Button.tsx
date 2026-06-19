// Button — pill CTAs (primary / ink / secondary) + text link, per pay.css .btn.
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui/Txt';
import { colors, radii, shadows, type } from '@/lib/theme';

type Variant = 'primary' | 'ink' | 'secondary';

export function Btn({
  label,
  onPress,
  variant = 'primary',
  disabled,
  icon,
  height = 54,
  style,
  haptic = true,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  icon?: React.ReactNode;
  height?: number;
  style?: ViewStyle;
  haptic?: boolean;
}) {
  const isPrimary = variant === 'primary';
  const textColor = variant === 'secondary' ? colors.ink : colors.white;
  const press = () => {
    if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.();
  };
  return (
    <Pressable
      disabled={disabled}
      onPress={press}
      style={({ pressed }) => [
        styles.btn,
        { height },
        variant === 'primary' && styles.primary,
        variant === 'ink' && styles.ink,
        variant === 'secondary' && styles.secondary,
        isPrimary && shadows.primaryBtn,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Txt style={[type.button, { color: textColor }]}>{label}</Txt>
    </Pressable>
  );
}

export function TextLink({ label, onPress, style }: { label: string; onPress?: () => void; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.55 }, style]}>
      <Txt style={type.textlink}>{label}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: '100%',
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  primary: { backgroundColor: colors.ink, borderColor: colors.accentLine }, // ink fill + 1px gold ring (+ gold glow via shadows.primaryBtn)
  ink: { backgroundColor: colors.ink },
  secondary: { backgroundColor: colors.surface, borderColor: colors.hair },
  pressed: { transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.4 },
  icon: { marginRight: 2 },
});
