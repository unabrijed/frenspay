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
import { Pressable as RNPressable, ScrollView as RNScrollView, Text, View as RNView, type TextStyle, type ViewStyle } from 'react-native';

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

/** Flatten an RN-style value (object | array | nested) into one RN style object — the real type.
 *  For native-only code (a StyleSheet.create, an RN component prop). */
export function rnStyle(...parts: (St | St[])[]): ViewStyle & TextStyle {
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

/** The shared-code flattener. Same runtime as rnStyle, typed as the web's CSSProperties so a shared
 *  component's `style={sx(...)}` typechecks once; RN receives the real object underneath. */
export function sx(...parts: (St | St[])[]): CSSProperties {
  return rnStyle(...parts) as unknown as CSSProperties;
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
    <RNView style={rnStyle(style as St[])} {...a11y(rest)}>
      {children}
    </RNView>
  );
}

/** `style` is the content container, as on web — flexGrow so a Spacer still fills a short page. */
export function ScrollView({ style, children, ...rest }: { style?: St | St[]; children?: ReactNode } & AnyProps) {
  return (
    <RNScrollView style={{ flex: 1 }} contentContainerStyle={rnStyle({ flexGrow: 1 }, style as St[])} {...a11y(rest)}>
      {children}
    </RNScrollView>
  );
}

export function Txt({ style, children, numberOfLines, ...rest }: { style?: St | St[]; children?: ReactNode; numberOfLines?: number } & AnyProps) {
  return (
    <Text allowFontScaling={false} numberOfLines={numberOfLines} style={rnStyle(style as St[])} {...a11y(rest)}>
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
      style={(s) => rnStyle((typeof style === 'function' ? style(s) : style) as St[])}
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
