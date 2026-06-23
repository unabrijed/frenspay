// icons.tsx — web port of the mobile icon set (react-native-svg → DOM SVG, 1:1 path data).
import type { ReactNode } from 'react';

import { colors } from '@/lib/theme';

export type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

type Render = (color: string, sw: number) => ReactNode;

function strokeIcon(viewBox: number, defaultStroke: number, defaultColor: string, render: Render) {
  return function Icon({ size = 22, color = defaultColor, strokeWidth = defaultStroke }: IconProps) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${viewBox} ${viewBox}`} fill="none" aria-hidden>
        {render(color, strokeWidth)}
      </svg>
    );
  };
}

const cap = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Icons = {
  Plus: strokeIcon(24, 1.7, colors.ink, (c, sw) => (
    <path d="M12 4v16M4 12h16" stroke={c} strokeWidth={sw} {...cap} />
  )),
  Send: strokeIcon(24, 1.7, colors.ink, (c, sw) => (
    <path d="M12 20V5M5 12l7-7 7 7" stroke={c} strokeWidth={sw} {...cap} />
  )),
  Request: strokeIcon(24, 1.7, colors.ink, (c, sw) => (
    <path d="M12 4v15M5 12l7 7 7-7" stroke={c} strokeWidth={sw} {...cap} />
  )),
  Chevron: strokeIcon(24, 1.7, colors.muted, (c, sw) => (
    <path d="M9 5l7 7-7 7" stroke={c} strokeWidth={sw} {...cap} />
  )),
  Back: strokeIcon(24, 1.7, colors.ink, (c, sw) => (
    <path d="M15 5l-7 7 7 7" stroke={c} strokeWidth={sw} {...cap} />
  )),
  Close: strokeIcon(24, 1.7, colors.muted, (c, sw) => (
    <path d="M6 6l12 12M18 6L6 18" stroke={c} strokeWidth={sw} {...cap} />
  )),
  Home: strokeIcon(24, 1.7, colors.muted, (c, sw) => (
    <path
      d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"
      stroke={c}
      strokeWidth={sw}
      {...cap}
    />
  )),
  Activity: strokeIcon(24, 1.7, colors.muted, (c, sw) => (
    <path d="M4 7h16M4 12h16M4 17h10" stroke={c} strokeWidth={sw} {...cap} />
  )),
  Swap: strokeIcon(24, 1.5, colors.muted, (c, sw) => (
    <path d="M4 7h13l-3.5-3.5M20 17H7l3.5 3.5" stroke={c} strokeWidth={sw} {...cap} />
  )),
  Mail: strokeIcon(24, 1.6, colors.muted, (c, sw) => (
    <g stroke={c} strokeWidth={sw} {...cap}>
      <rect x={3} y={5} width={18} height={14} rx={2.5} />
      <path d="M4 7l8 6 8-6" />
    </g>
  )),
  Device: strokeIcon(24, 1.6, colors.muted, (c, sw) => (
    <g stroke={c} strokeWidth={sw} {...cap}>
      <rect x={7} y={3} width={10} height={18} rx={2.5} />
      <path d="M11 18h2" />
    </g>
  )),
  Search: strokeIcon(24, 1.6, colors.muted, (c, sw) => (
    <g stroke={c} strokeWidth={sw} {...cap}>
      <circle cx={11} cy={11} r={7} />
      <path d="M21 21l-4-4" />
    </g>
  )),
  Copy: strokeIcon(24, 1.6, colors.accent, (c, sw) => (
    <g stroke={c} strokeWidth={sw} {...cap}>
      <rect x={9} y={9} width={11} height={11} rx={2.5} />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </g>
  )),
  LockCheck: strokeIcon(24, 2, colors.accent, (c, sw) => (
    <path d="M8.5 12.5l2.5 2.5 5-5" stroke={c} strokeWidth={sw} {...cap} />
  )),
  Face: strokeIcon(24, 1.6, colors.muted, (c, sw) => (
    <g stroke={c} strokeWidth={sw} {...cap}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M9 10v1M15 10v1M12 10v3l-1 0M9.5 15s1 1 2.5 1 2.5-1 2.5-1" />
    </g>
  )),
  Qr: strokeIcon(18, 1.5, colors.accent, (c, sw) => (
    <g stroke={c} strokeWidth={sw} fill="none">
      <rect x={1} y={1} width={6} height={6} rx={1} />
      <rect x={11} y={1} width={6} height={6} rx={1} />
      <rect x={1} y={11} width={6} height={6} rx={1} />
      <path d="M11 11h2v2M15 11v6M11 15h2v2" strokeLinecap="round" />
    </g>
  )),
  QrBig: strokeIcon(26, 1.9, colors.white, (c, sw) => (
    <g stroke={c} strokeWidth={sw} fill="none">
      <rect x={2.5} y={2.5} width={8} height={8} rx={1.5} />
      <rect x={15.5} y={2.5} width={8} height={8} rx={1.5} />
      <rect x={2.5} y={15.5} width={8} height={8} rx={1.5} />
      <path d="M15.5 15.5h3.5v3.5M23 15.5v8M15.5 23h3.5" strokeLinecap="round" />
    </g>
  )),
  Check: strokeIcon(30, 2.4, colors.accent, (c, sw) => (
    <path d="M8 15.5l4.5 4.5L22 10" stroke={c} strokeWidth={sw} {...cap} />
  )),
  XBig: strokeIcon(28, 2.4, colors.muted, (c, sw) => (
    <path d="M9 9l10 10M19 9L9 19" stroke={c} strokeWidth={sw} strokeLinecap="round" />
  )),
};
