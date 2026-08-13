'use client';

// MaskedAmount — one amount, honoring the global eye (docs/05): renders `value`, or a dot-mask
// with a tap-to-reveal eye while store.hideAmounts is on. Reveal is per-row and EPHEMERAL — local
// state that unmounts on navigation, never lifted to the store, so a revealed row can't follow
// the user around. Reveal state can be lifted by the CALLER (revealed/onToggle) when one tap must
// reveal several texts together (TxCard's USD + ≈local pair); left alone it manages itself.
import { useState } from 'react';
import type { ComponentProps } from 'react';

import { Icons } from '@/components/icons';
import { Pressable } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { colors } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

const MASK = '••••';

export function MaskedAmount({
  value,
  style,
  revealed,
  onToggle,
}: {
  value: string;
  style?: ComponentProps<typeof Txt>['style'];
  /** Controlled reveal — pass with `onToggle` when one tap must reveal sibling texts too. */
  revealed?: boolean;
  onToggle?: () => void;
}) {
  const hidden = usePayStore((s) => s.hideAmounts);
  const [own, setOwn] = useState(false);
  const shown = !hidden || (revealed ?? own);
  const toggle = onToggle ?? (() => setOwn((v) => !v));
  return (
    <Pressable
      // While masked, the tap toggles THIS row's reveal and must not bubble into the row's own
      // onPress (a TxCard tap opens the detail page). The rn shim spreads extra props after its
      // own onClick, so this override both stops propagation and does the toggle. Unmasked, no
      // handler — taps fall through to the row as before.
      {...(hidden ? { onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); toggle(); } } : {})}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Txt style={style}>{shown ? value : MASK}</Txt>
      {hidden ? (
        shown ? (
          <Icons.EyeOff size={13} color={colors.muted} />
        ) : (
          <Icons.Eye size={13} color={colors.muted} />
        )
      ) : null}
    </Pressable>
  );
}
