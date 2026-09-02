// icons.native.tsx — the same `Icons.*` API over @expo/vector-icons' MaterialIcons font. One glyph
// name per icon, mapped from the Material Symbols name the web uses (underscores → hyphens).
// ponytail: MaterialIcons is the FILLED family — the web renders Material Symbols *Outlined* — and
// `fill`/`weight` are accepted and ignored. Swap to the Symbols TTF via expo-font if it grates.
import { MaterialIcons } from '@expo/vector-icons';

import { colors } from './theme';

export type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number; // accepted for back-compat; ignored
  fill?: boolean;
  weight?: number;
};

type Glyph = keyof typeof MaterialIcons.glyphMap;

function symbol(name: Glyph, defaultColor: string = colors.ink) {
  return function Icon({ size = 22, color = defaultColor }: IconProps) {
    return <MaterialIcons name={name} size={size} color={color} />;
  };
}

export const Icons = {
  Plus: symbol('add', colors.ink),
  Eye: symbol('visibility', colors.muted),
  EyeOff: symbol('visibility-off', colors.muted),
  Send: symbol('arrow-outward', colors.ink),
  Request: symbol('arrow-downward', colors.ink),
  Chevron: symbol('chevron-right', colors.muted),
  Back: symbol('arrow-back', colors.ink),
  Close: symbol('close', colors.muted),
  Home: symbol('home', colors.muted),
  Activity: symbol('history', colors.muted),
  Swap: symbol('swap-horiz', colors.muted),
  Mail: symbol('mail', colors.muted),
  Device: symbol('devices', colors.muted),
  Search: symbol('search', colors.muted),
  Copy: symbol('content-copy', colors.accent),
  LockCheck: symbol('verified', colors.accent),
  Face: symbol('fingerprint', colors.muted),
  Qr: symbol('qr-code-2', colors.accent),
  QrBig: symbol('qr-code-scanner', colors.white),
  Check: symbol('check', colors.accent),
  XBig: symbol('close', colors.muted),
  ThumbUp: symbol('thumb-up', colors.accent),
  ThumbDown: symbol('thumb-down', colors.muted),
  Pin: symbol('location-on', colors.secondary),
  Bell: symbol('notifications', colors.ink),
  Wallet: symbol('account-balance-wallet', colors.accent),
  Person: symbol('person', colors.muted),
};
