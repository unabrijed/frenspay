'use client';

// /account/capacity — the most this partner will carry in flight at once. Their own claim; routing uses
// min(this, stake × leverage), so a number above the cap buys nothing and the hint says so.
import { usd } from '@fpay/shared';

import { OneField } from '@/components/OneField';
import { setMerchantFloat } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

export default function Capacity() {
  const m = useLpStore((s) => s.merchant);
  return (
    <OneField
      title="Capacity"
      hint={`Most you carry in payouts at once, in dollars. ${Number(m?.minBondUsdc ?? 0) > 0 ? 'Your stake caps it' : 'Capped'} at ${usd(m?.maxFloatUsdc ?? '0')}.`}
      placeholder="5000"
      initial={String(Number(m?.floatUsdc ?? 0))}
      validate={(v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? null : 'Enter a number, like 5000.')}
      submit={(v) => setMerchantFloat(Number(v))}
    />
  );
}
