'use client';

// /account/phone — the number we call if a payout goes wrong. Same shape rule as /apply.
import { OneField } from '@/components/OneField';
import { setContactPhone } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

export default function Phone() {
  const m = useLpStore((s) => s.merchant);
  return (
    <OneField
      title="Contact number"
      hint="How we reach you if a payout goes wrong. Not shown to anyone you pay."
      placeholder="+91 98765 43210"
      initial={m?.contactPhone ?? '+91 '}
      validate={(v) => (/^\+[1-9]\d{6,14}$/.test(v.replace(/\s/g, '')) ? null : 'Include the country code, like +919876543210.')}
      submit={(v) => setContactPhone(v.replace(/\s/g, ''))}
    />
  );
}
