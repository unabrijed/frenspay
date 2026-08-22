// Screen.native.tsx — the real SafeAreaView. Same `edges` prop as the web stand-in.
import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { rnStyle, type St } from './rn';

type Edge = 'top' | 'bottom' | 'left' | 'right';

export function Screen({ children, edges = ['top'], style }: { children: ReactNode; edges?: Edge[]; style?: St | St[] }) {
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1 }, rnStyle(style as St[])]}>
      {children}
    </SafeAreaView>
  );
}
