'use client';

// Button — pill CTAs (primary / ink / secondary) + text link, web port.
import type { CSSProperties, ReactNode } from 'react';

import { Txt } from './Txt';
import { Mark } from './primitives';
import { haptic as doHaptic, Pressable, View } from './rn';
import { colors, radii, shadows, type } from './theme';

type Variant = 'primary' | 'ink' | 'secondary';

export function Btn({
  label,
  onPress,
  variant = 'primary',
  disabled,
  icon,
  pending,
  height = 54,
  style,
  haptic = true,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  icon?: ReactNode;
  /** Something is in flight: the mark takes the icon slot and passes a bead between
      the two frens. Give the label the pending wording too ("Saving…") — the motion
      is the flourish, never the message. */
  pending?: boolean;
  height?: number;
  style?: CSSProperties;
  haptic?: boolean;
}) {
  const isPrimary = variant === 'primary';
  const textColor = variant === 'secondary' ? colors.ink : colors.white;
  // The bead is a GAP in the curve, so it has to be painted in whatever the button
  // itself is. Left at its default it was terracotta on an ink button — a dot stuck
  // on the mark rather than something passing along it.
  const surface =
    variant === 'primary' ? colors.accent : variant === 'ink' ? colors.ink : colors.surface;
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        if (haptic) doHaptic();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        { height },
        variant === 'primary' && styles.primary,
        variant === 'ink' && styles.ink,
        variant === 'secondary' && styles.secondary,
        isPrimary && { ...shadows.primaryBtn },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {pending ? (
        <View style={styles.icon}>
          <Mark size={18} state="joining" color={textColor} bead={surface} />
        </View>
      ) : icon ? (
        <View style={styles.icon}>{icon}</View>
      ) : null}
      <Txt style={[type.button, { color: textColor }]}>{label}</Txt>
    </Pressable>
  );
}

export function TextLink({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress?: () => void;
  style?: CSSProperties;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.55 }, style]}>
      <Txt style={type.textlink}>{label}</Txt>
    </Pressable>
  );
}

const styles = {
  btn: {
    width: '100%',
    borderRadius: radii.tile,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    // styles.pressed already moves the button; without this every CTA in the app
    // snaps to it and back. 140ms — longer makes the press-down feel laggy.
    transition: 'transform var(--dur-quick) var(--ease-soft)',
  },
  primary: { backgroundColor: colors.accent, borderColor: 'transparent' }, // terracotta CTA
  ink: { backgroundColor: colors.ink },
  secondary: { backgroundColor: colors.surface, borderColor: colors.outlineVariant },
  pressed: { transform: 'translateY(1px) scale(0.99)' },
  disabled: { opacity: 0.4 },
  icon: { marginRight: 2 },
} satisfies Record<string, CSSProperties>;
