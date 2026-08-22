'use client';

// rn.tsx — a tiny React Native compatibility layer so the mobile components/screens port
// to web nearly 1:1. View defaults to RN's flex model (column), Txt is a span, Pressable is
// an accessible role=button div that supports RN's `style={({pressed}) => [...]}` pattern,
// and `sx` flattens RN-style arrays into a single CSSProperties object.
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { useState } from 'react';

export type St = CSSProperties | false | null | undefined;

/** Native-only alias (see rn.native.tsx); on web it is simply sx. */
export const rnStyle = (...parts: (St | St[])[]): CSSProperties => sx(...parts);

/** Flatten an RN-style value (object | array | nested) into one CSSProperties. */
export function sx(...parts: (St | St[])[]): CSSProperties {
  const out: CSSProperties = {};
  for (const p of parts.flat(2 as 1)) if (p) Object.assign(out, p as CSSProperties);
  return out;
}

// RN defaults: flex, column. Mirrors react-native so ported StyleSheet values behave the same.
const viewBase: CSSProperties = { display: 'flex', flexDirection: 'column', boxSizing: 'border-box', minHeight: 0, minWidth: 0 };

type DivProps = Omit<HTMLAttributes<HTMLDivElement>, 'style'>;
type SpanProps = Omit<HTMLAttributes<HTMLSpanElement>, 'style'>;

export function View({ style, children, ...rest }: { style?: St | St[]; children?: ReactNode } & DivProps) {
  return (
    <div style={sx(viewBase, style as St[])} {...rest}>
      {children}
    </div>
  );
}

export function Txt({ style, children, ...rest }: { style?: St | St[]; children?: ReactNode } & SpanProps) {
  return (
    <span style={sx(style as St[])} {...rest}>
      {children}
    </span>
  );
}

type PressableStyle = St | St[] | ((s: { pressed: boolean }) => St | St[]);

export function Pressable({
  onPress,
  disabled,
  style,
  children,
  // RN-only props accepted + ignored on web
  hitSlop: _hitSlop,
  ...rest
}: {
  onPress?: () => void;
  disabled?: boolean;
  style?: PressableStyle;
  children?: ReactNode;
  hitSlop?: number;
} & DivProps) {
  const [pressed, setPressed] = useState(false);
  const resolved = typeof style === 'function' ? style({ pressed }) : style;
  return (
    <div
      role="button"
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      // RN semantics: the innermost Pressable with a handler takes the tap; it never reaches an outer one.
      onClick={(e) => {
        if (disabled || !onPress) return;
        e.stopPropagation();
        onPress();
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onPress?.();
        }
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={sx(viewBase, { cursor: disabled ? 'default' : 'pointer', userSelect: 'none' }, resolved as St[])}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Best-effort tactile feedback (no-op where unsupported). */
export function haptic() {
  try {
    (navigator as Navigator & { vibrate?: (n: number) => boolean }).vibrate?.(8);
  } catch {
    /* ignore */
  }
}
