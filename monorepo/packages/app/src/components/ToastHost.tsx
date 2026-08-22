'use client';

// ToastHost — store-driven transient snackbar layer (mirrors SheetHost). One toast at a time,
// set via store.notify(), fades + rises in, auto-clears (timer lives in the store). Tap to dismiss.
// Mounted once in the root layout, above the sheet layer.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { colors, fonts, Pressable, radii, shadows, Txt, View } from '@fpay/ui';
import { usePayStore } from '../store';

export function ToastHost() {
  const toast = usePayStore((s) => s.toast);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!toast) {
      setShown(false);
      return undefined;
    }
    // Reset to the pre-entrance state first so a toast that REPLACES a still-visible one re-runs the
    // rise+fade — the value must actually change for the CSS transition to fire.
    setShown(false);
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [toast?.id]); // re-trigger the entrance whenever a new toast replaces the current one

  if (!toast) return null;
  const accent = toast.tone === 'success' ? colors.accent : colors.danger;

  return (
    <View style={styles.wrap} role="status" aria-live="polite">
      <Pressable
        onPress={() => usePayStore.setState({ toast: null })}
        style={{ ...styles.toast, opacity: shown ? 1 : 0, transform: shown ? 'translateY(0)' : 'translateY(12px)' }}>
        <View style={{ ...styles.dot, backgroundColor: accent }} />
        <Txt style={styles.msg}>{toast.msg}</Txt>
      </Pressable>
    </View>
  );
}

const styles = {
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Sits above the tab bar; nudge this offset if the tab bar height changes (calibration knob).
    bottom: 90,
    paddingBottom: 'env(safe-area-inset-bottom)', // web only; native ignores env()
    display: 'flex',
    justifyContent: 'center',
    paddingLeft: 20,
    paddingRight: 20,
    zIndex: 60, // above SheetHost (50)
    pointerEvents: 'none', // never block the UI beneath — the toast itself re-enables pointer events
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 440,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 16,
    paddingRight: 16,
    backgroundColor: colors.ink,
    borderRadius: radii.card,
    ...shadows.sheet,
    transition: 'opacity 240ms ease, transform 240ms ease',
    pointerEvents: 'auto',
    cursor: 'pointer',
  },
  dot: { width: 8, height: 8, borderRadius: 8, flexShrink: 0 },
  msg: { ...fonts.body500, fontSize: 14, lineHeight: '20px', color: colors.white },
} satisfies Record<string, CSSProperties>;
