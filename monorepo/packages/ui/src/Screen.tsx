'use client';

// Screen — web stand-in for react-native-safe-area-context's SafeAreaView. Fills the phone
// column and applies safe-area inset padding on the requested edges (0 on desktop).
import type { CSSProperties, ReactNode } from 'react';

import { type St, View } from './rn';

type Edge = 'top' | 'bottom' | 'left' | 'right';

export function Screen({
  children,
  edges = ['top'],
  style,
}: {
  children: ReactNode;
  edges?: Edge[];
  style?: St | St[];
}) {
  const pad: CSSProperties = {
    paddingTop: edges.includes('top') ? 'env(safe-area-inset-top)' : undefined,
    paddingBottom: edges.includes('bottom') ? 'env(safe-area-inset-bottom)' : undefined,
    paddingLeft: edges.includes('left') ? 'env(safe-area-inset-left)' : undefined,
    paddingRight: edges.includes('right') ? 'env(safe-area-inset-right)' : undefined,
  };
  return <View style={[{ flex: 1, minHeight: '100%' }, pad, style as St]}>{children}</View>;
}
