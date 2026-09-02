// claims — one line per stake claim, in the partner's words. Shared by /stake and Activity so the two
// screens say the same thing about the same row. Once accepted, the transfer's status is the truth.
import type { StakeClaim } from '@fpay/shared';

import { colors } from '@fpay/ui/theme';

/** Still moving: the server has not decided, or has and the chain check has not finished. */
export const isPendingClaim = (c: StakeClaim) =>
  c.status === 'submitted' || (c.status === 'accepted' && c.transferStatus !== 'confirmed' && c.transferStatus !== 'failed');

export function claimLabel(c: StakeClaim): { text: string; color: string } {
  switch (c.status) {
    case 'submitted':
      return { text: 'Being checked', color: colors.muted };
    case 'accepted':
      if (c.transferStatus === 'confirmed') return { text: 'Added to your stake', color: colors.accent };
      if (c.transferStatus === 'failed') return { text: 'Didn’t check out. Contact us', color: colors.danger };
      return { text: 'Confirming', color: colors.muted };
    case 'rejected':
      return { text: c.note ? `Not accepted: ${c.note}` : 'Not accepted', color: colors.danger };
    case 'duplicate':
      return { text: 'Already used', color: colors.danger };
  }
}

export const shortSig = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
