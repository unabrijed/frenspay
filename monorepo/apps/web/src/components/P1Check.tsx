'use client';

import { inr, usd } from '@/lib/money';
import { colors, type as t } from '@/lib/theme';
import { usePayStore, useStoreHydrated } from '@/store/usePayStore';

// P1 verification only — confirms the ported store + mock wallet provider + money
// formatters + hydration all work in the browser. Removed once real screens land (P3).
export function P1Check() {
  const hydrated = useStoreHydrated();
  const balanceUSD = usePayStore((s) => s.balanceUSD);
  const txCount = usePayStore((s) => s.transactions.length);
  const onboarded = usePayStore((s) => s.onboarded);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        marginTop: 12,
        padding: 14,
        borderRadius: 14,
        background: colors.inkSoft,
      }}
    >
      <div style={t.eyebrow}>P1 store check</div>
      {!hydrated ? (
        <div style={t.sub}>hydrating…</div>
      ) : (
        <>
          <div style={t.rowAmount}>
            {usd(balanceUSD)} · {inr(balanceUSD)}
          </div>
          <div style={t.rowTime}>
            {txCount} mock transactions · onboarded: {String(onboarded)}
          </div>
        </>
      )}
    </div>
  );
}
