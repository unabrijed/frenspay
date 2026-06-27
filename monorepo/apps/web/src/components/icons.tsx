// icons.tsx — Tabroad icon set, backed by Material Symbols Outlined (loaded in layout.tsx).
// The `Icons.*` API (size / color / fill) is preserved so call sites are unchanged; each icon is
// a glyph name. `strokeWidth` is accepted but ignored (Material Symbols use a weight axis instead).
import type { CSSProperties } from 'react';

import { colors } from '@/lib/theme';

export type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number; // accepted for back-compat; ignored
  fill?: boolean; // FILL axis (active/emphasis)
  weight?: number; // wght axis (default 400)
};

function symbol(name: string, defaultColor: string = colors.ink, defaultFill = false) {
  return function Icon({ size = 22, color = defaultColor, fill = defaultFill, weight = 400 }: IconProps) {
    const style: CSSProperties = {
      fontSize: size,
      lineHeight: 1,
      color,
      width: size,
      height: size,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${Math.round(size)}`,
    };
    return (
      <span className="material-symbols-outlined" aria-hidden style={style}>
        {name}
      </span>
    );
  };
}

export const Icons = {
  Plus: symbol('add', colors.ink),
  Send: symbol('arrow_outward', colors.ink),
  Request: symbol('arrow_downward', colors.ink),
  Chevron: symbol('chevron_right', colors.muted),
  Back: symbol('arrow_back', colors.ink),
  Close: symbol('close', colors.muted),
  Home: symbol('home', colors.muted),
  Activity: symbol('history', colors.muted),
  Swap: symbol('swap_horiz', colors.muted),
  Mail: symbol('mail', colors.muted),
  Device: symbol('devices', colors.muted),
  Search: symbol('search', colors.muted),
  Copy: symbol('content_copy', colors.accent),
  LockCheck: symbol('verified', colors.accent),
  Face: symbol('fingerprint', colors.muted),
  Qr: symbol('qr_code_2', colors.accent),
  QrBig: symbol('qr_code_scanner', colors.white),
  Check: symbol('check', colors.accent),
  XBig: symbol('close', colors.muted),
  Pin: symbol('location_on', colors.secondary),
  Bell: symbol('notifications', colors.ink),
  Wallet: symbol('account_balance_wallet', colors.accent),
};
