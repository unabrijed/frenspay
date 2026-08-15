'use client';

// Keypad — mono numeric keypad (1–9, 00, 0, ⌫) per pay.css .keypad. Web port.
import type { CSSProperties } from 'react';

import { Txt } from './Txt';
import { haptic, Pressable, View } from './rn';
import { colors, type } from './theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'];

export function Keypad({ onPress }: { onPress: (key: string) => void }) {
  return (
    <View style={styles.keypad}>
      {KEYS.map((k) => {
        const fn = k === '⌫' || k === '00';
        return (
          <Pressable
            key={k}
            onPress={() => {
              haptic();
              onPress(k);
            }}
            style={({ pressed }) => [styles.key, pressed && { backgroundColor: colors.inkSoft }]}>
            <Txt style={fn ? type.keypadFn : type.keypad}>{k}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = {
  keypad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, marginBottom: 14 },
  key: {
    width: '33.333%',
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
} satisfies Record<string, CSSProperties>;
