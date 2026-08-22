// rn.native.tsx — the React Native side of the compat layer. Metro picks this file over rn.tsx
// on ios/android; Next never sees it. Same exports, same prop shapes, so every shared component
// typechecks once against the web-flavoured `St` and renders here untouched.
//
// The one real job is `sx`: shared styles are written as CSSProperties, and a few keys only mean
// something to a browser (a transition, a cursor, a `14px` string). Rather than fork every style
// object, sx() drops or converts those on the way into RN. ponytail: a deny-list, not a full CSS
// parser — extend WEB_ONLY when RN warns about a new key.
import * as Haptics from 'expo-haptics';
import type { CSSProperties, ReactNode } from 'react';
import { Pressable as RNPressable, Text, View as RNView, type TextStyle, type ViewStyle } from 'react-native';

export type St = CSSProperties | false | null | undefined;

const WEB_ONLY = new Set([
  'transition',
  'cursor',
  'userSelect',
  'boxSizing',
  'outline',
  'whiteSpace',
  'textOverflow',
  'overflowY',
  'overflowX',
  'animationDelay',
  'fontVariantNumeric',
  'WebkitTapHighlightColor',
  'offsetPath',
]);
const PX = /^(-?\d+(?:\.\d+)?)px$/;

/** Flatten an RN-style value (object | array | nested) into one RN style object. */
export function sx(...parts: (St | St[])[]): ViewStyle & TextStyle {
  const out: Record<string, unknown> = {};
  for (const p of parts.flat(2 as 1)) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined || WEB_ONLY.has(k)) continue;
      if (typeof v === 'string') {
        const px = PX.exec(v);
        if (px) {
          out[k] = Number(px[1]);
          continue;
        }
        if (v.startsWith('calc(') || v.startsWith('env(') || v.startsWith('var(')) continue;
        if (k === 'display' && v !== 'flex' && v !== 'none') continue; // inline-flex etc: RN Views already flex
        if (k === 'position' && v !== 'absolute' && v !== 'relative') {
          out[k] = 'absolute'; // fixed / sticky
          continue;
        }
      }
      out[k] = v;
    }
  }
  return out as ViewStyle & TextStyle;
}

type AnyProps = Record<string, unknown>;
/** RN accepts `role` and `aria-*` (0.72+); the rest of a div's props have no native meaning. */
function a11y(rest: AnyProps): AnyProps {
  const keep: AnyProps = {};
  for (const [k, v] of Object.entries(rest)) if (k === 'role' || k === 'testID' || k.startsWith('aria-')) keep[k] = v;
  return keep;
}

export function View({ style, children, ...rest }: { style?: St | St[]; children?: ReactNode } & AnyProps) {
  return (
    <RNView style={sx(style as St[])} {...a11y(rest)}>
      {children}
    </RNView>
  );
}

export function Txt({ style, children, ...rest }: { style?: St | St[]; children?: ReactNode } & AnyProps) {
  return (
    <Text allowFontScaling={false} style={sx(style as St[])} {...a11y(rest)}>
      {children}
    </Text>
  );
}

type PressableStyle = St | St[] | ((s: { pressed: boolean }) => St | St[]);

export function Pressable({
  onPress,
  disabled,
  style,
  children,
  hitSlop,
  ...rest
}: {
  onPress?: () => void;
  disabled?: boolean;
  style?: PressableStyle;
  children?: ReactNode;
  hitSlop?: number;
} & AnyProps) {
  return (
    <RNPressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      style={(s) => sx((typeof style === 'function' ? style(s) : style) as St[])}
      {...a11y(rest)}
    >
      {children}
    </RNPressable>
  );
}

/** Best-effort tactile feedback. */
export function haptic() {
  void Haptics.selectionAsync().catch(() => {});
}
