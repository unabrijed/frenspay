'use client';

import { useState } from 'react';

import { useCity } from './CityContext';
import { useCountUp } from './useCountUp';

const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function QuoteWidget() {
  const { city } = useCity();
  const [raw, setRaw] = useState('20');

  // The rate tweens, not the product — typing stays instant per keystroke,
  // while switching city sweeps both the big number and the rate row.
  const rate = useCountUp(city.rate);
  const amount = Math.min(1000, Math.max(0, parseFloat(raw) || 0));
  const fee = amount === 0 ? 0 : Math.max(0.05, amount * 0.005);
  const localFmt = new Intl.NumberFormat(city.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    // text-ink is load-bearing: this card sits on the terracotta Rates section,
    // which sets text-white. A white card has to declare its own colour rather
    // than inherit whatever surface it happens to be dropped on.
    <div className="mx-auto w-full max-w-[560px] rounded-[28px] bg-white p-6 text-ink shadow-lift ring-1 ring-hair sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <label className="block flex-1">
          <span className="eyebrow text-muted">You pay</span>
          <span className="mt-1 flex items-baseline gap-1 border-b border-hair pb-2">
            <span className="text-[22px] font-semibold text-muted/70">$</span>
            <input
              value={raw}
              onChange={(e) => setRaw(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              aria-label="Amount in dollars"
              className="tabular w-full bg-transparent text-[32px] font-extrabold tracking-[-0.02em] placeholder:text-muted/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-terra"
              placeholder="20"
            />
          </span>
        </label>

        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-peach px-3 py-1.5 text-[12px] font-semibold text-terra">
          <span className="h-1.5 w-1.5 rounded-full bg-terra" />
          Rate locked
        </span>
      </div>

      <div className="mt-6">
        <span className="eyebrow text-muted">Merchant gets</span>
        <div className="tabular mt-0.5 text-[40px] font-extrabold leading-tight tracking-[-0.02em]">
          {city.symbol}
          {localFmt.format(amount * rate)}
        </div>
      </div>

      <dl className="mt-5 divide-y divide-hair border-t border-hair text-[15px]">
        <div className="flex justify-between py-3">
          <dt className="text-muted">Rate</dt>
          <dd className="tabular font-semibold">
            {city.symbol}
            {rate.toFixed(2)} / $1 · locked
          </dd>
        </div>
        <div className="flex justify-between py-3">
          <dt className="text-muted">Fee</dt>
          <dd className="tabular font-semibold">${usdFmt.format(fee)}</dd>
        </div>
        <div className="flex justify-between py-3">
          <dt className="text-muted">Total from balance</dt>
          <dd className="tabular font-semibold">${usdFmt.format(amount + fee)}</dd>
        </div>
        <div className="flex justify-between py-3">
          <dt className="text-muted">Arrival</dt>
          <dd className="font-semibold text-teal">Instant · {city.rail}</dd>
        </div>
      </dl>

      <p className="mt-4 text-[12px] text-muted/80">Demo rates. Live quotes in the app.</p>
    </div>
  );
}
