// Skeleton — a shimmering placeholder block for content that's still loading. Reuses the
// `.skeleton` class + `shimmer` keyframe in globals.css. Use while `firstLoadDone` is false so
// screens read as "loading" instead of flashing empty→full (see usePayStore.firstLoadDone).
import type { CSSProperties } from 'react';

import { colors, radii, shadows } from '@/lib/theme';

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
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, flex: '0 0 auto', ...style }} />;
}

/** One transaction-row placeholder (avatar · two text lines · amount) matching a TxCard's frame. */
export function TxRowSkeleton() {
  return (
    <div style={rowStyle}>
      <Skeleton w={42} h={42} r={999} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <Skeleton w="55%" h={13} />
        <Skeleton w="34%" h={11} />
      </div>
      <Skeleton w={54} h={14} />
    </div>
  );
}

/** N transaction-row placeholders (default 3). */
export function TxListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <TxRowSkeleton key={i} />
      ))}
    </>
  );
}

const rowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  backgroundColor: colors.surface,
  borderRadius: radii.card,
  border: `1px solid ${colors.outlineVariant}`,
  ...shadows.card,
  paddingTop: 14,
  paddingBottom: 14,
  paddingLeft: 14,
  paddingRight: 14,
};
