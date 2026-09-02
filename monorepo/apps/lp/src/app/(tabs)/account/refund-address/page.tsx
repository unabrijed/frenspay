'use client';

// /account/refund-address — where an OPEN stake request goes. Exists because leaving cannot be
// cancelled; a typo in that address would otherwise be a support ticket.
import { OneField, payoutAddressOrNull } from '@/components/OneField';
import { setWithdrawalAddress } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

export default function RefundAddress() {
  const m = useLpStore((s) => s.merchant);
  const w = m?.pendingWithdrawal;
  return (
    <OneField
      title="Send it to"
      hint="A Solana address that holds USDC. Your fpay wallet is filled in."
      placeholder="Solana address"
      initial={w?.payoutAddress ?? m?.payoutWallet ?? ''}
      validate={() => (w ? null : 'Nothing is on its way back right now.')}
      submit={(v) => setWithdrawalAddress(w!.id, payoutAddressOrNull(v, m?.payoutWallet))}
    />
  );
}
