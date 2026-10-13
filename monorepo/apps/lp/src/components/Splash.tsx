'use client';

// Splash — the holding frame while Dynamic rehydrates. Deliberately just the mark on the canvas:
// anything more would flash and be replaced within a second.
import { Mark } from '@fpay/ui/primitives';
import { View } from '@fpay/ui/rn';
import { colors } from '@fpay/ui/theme';

export function Splash() {
  return (
    <View
      style={{
        flex: 1,
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.canvas,
      }}
    >
      <Mark size={56} state="idle" />
    </View>
  );
}
