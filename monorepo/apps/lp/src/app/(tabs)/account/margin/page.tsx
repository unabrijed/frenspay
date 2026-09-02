'use client';

// /account/margin — what the partner keeps per payout, inside the tier's envelope. The cap is the
// tier's, so the hint names the real bound and a refusal reads as "your tier", not as a bug.
import { OneField } from '@/components/OneField';
import { setMerchantSpread } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

export default function Margin() {
  const m = useLpStore((s) => s.merchant);
  const cap = (m?.maxSpreadBps ?? 100) / 100;
  return (
    <OneField
      title="Your margin"
      hint={`A percent, from 0.10 to ${cap.toFixed(2)} at your tier. Lower wins more work.`}
      placeholder="0.50"
      initial={((m?.spreadBps ?? 50) / 100).toFixed(2)}
      validate={(v) => {
        const pct = Number(v);
        if (!Number.isFinite(pct)) return 'Enter a percent, like 0.50.';
        if (pct < 0.1 || pct > cap) return `Between 0.10 and ${cap.toFixed(2)} at your tier.`;
        return null;
      }}
      submit={(v) => setMerchantSpread(Math.round(Number(v) * 100))}
    />
  );
}
