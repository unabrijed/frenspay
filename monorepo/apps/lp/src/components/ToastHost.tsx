'use client';

// ToastHost — store-driven transient snackbar. One at a time, set via store.notify(), auto-clears
// (the timer lives in the store). Mounted once in the root layout.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { Txt } from '@fpay/ui/Txt';
import { colors, radii, shadows } from '@fpay/ui/theme';

import { useLpStore } from '@/store/useLpStore';

export function ToastHost() {
  const toast = useLpStore((s) => s.toast);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!toast) {
      setShown(false);
      return undefined;
    }
    // Reset to the pre-entrance state first so a toast REPLACING a visible one re-runs the
    // rise+fade — the value has to actually change for the CSS transition to fire.
    setShown(false);
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [toast?.id]);

  if (!toast) return null;
  const accent = toast.tone === 'success' ? colors.accent : colors.danger;
  return (
    <div style={{ ...styles.wrap, opacity: shown ? 1 : 0, transform: shown ? 'translateY(0)' : 'translateY(8px)' }}>
      <div style={{ ...styles.toast, borderLeftColor: accent }}>
        <Txt style={{ color: colors.ink, fontSize: 14 }}>{toast.msg}</Txt>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 24,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 50,
    transition: 'opacity var(--dur-quick) var(--ease-soft), transform var(--dur-quick) var(--ease-soft)',
  },
  toast: {
    maxWidth: 420,
    margin: '0 20px',
    padding: '12px 16px',
    borderRadius: radii.card,
    borderLeft: '3px solid',
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
  },
} satisfies Record<string, CSSProperties>;
