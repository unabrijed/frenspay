// Skeleton — a shimmering placeholder block for content that's still loading. Reuses the
// `.skeleton` class + `shimmer` keyframe in globals.css. Use while `firstLoadDone` is false so
// screens read as "loading" instead of flashing empty→full (see usePayStore.firstLoadDone).
import type { CSSProperties } from 'react';

import { colors, radii, shadows, View } from '@fpay/ui';

export function Skeleton({
  w = '100%',
  h = 14,
  r = 8,
  style,
}: {
  w?: number | string;
  h?: number | string;
  /** border-radius in px (use a large value like 999 for pills/circles). */
  r?: number;
  style?: CSSProperties;
}) {
  // backgroundColor is the native look; on web the .skeleton class paints its shimmer gradient over it.
  return <View aria-hidden="true" className="skeleton" style={{ width: w, height: h, borderRadius: r, flexGrow: 0, flexShrink: 0, backgroundColor: colors.surfaceLow, ...style }} />;
}

/** One transaction-row placeholder (avatar · two text lines · amount) matching a TxCard's frame. */
export function TxRowSkeleton({ index = 0 }: { index?: number }) {
  return (
    <View style={rowStyle} aria-hidden="true">
      <Skeleton w={42} h={42} r={999} />
      <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
        <Skeleton w={['55%', '70%', '45%'][index % 3]} h={13} />
        <Skeleton w={['34%', '45%', '30%'][index % 3]} h={11} />
      </View>
      <Skeleton w={54} h={14} />
    </View>
  );
}

/** N transaction-row placeholders (default 3). */
export function TxListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View role="status" aria-label="Loading activity" style={{ gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <TxRowSkeleton key={i} index={i} />
      ))}
    </View>
  );
}

/** A quiet page frame while navigation resolves inside the app shell. */
export function PageSkeleton() {
  return (
    <View style={{ paddingTop: 32, paddingBottom: 32, paddingLeft: 24, paddingRight: 24, gap: 28 }}>
      <View aria-hidden="true" style={{ gap: 12 }}>
        <Skeleton w="46%" h={28} r={10} />
        <Skeleton w="68%" h={14} />
      </View>
      <View aria-hidden="true" style={{ backgroundColor: colors.surface, borderRadius: radii.card, padding: 24, gap: 16 }}>
        <Skeleton w="30%" h={12} />
        <Skeleton w="62%" h={44} r={12} />
        <Skeleton w="42%" h={12} />
      </View>
      <TxListSkeleton rows={3} />
    </View>
  );
}

const rowStyle: CSSProperties = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  backgroundColor: colors.surface,
  borderRadius: radii.card,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: colors.outlineVariant,
  ...shadows.card,
  paddingTop: 14,
  paddingBottom: 14,
  paddingLeft: 14,
  paddingRight: 14,
};
