'use client';

import { useCity } from './CityContext';
import { useCountUp } from './useCountUp';

const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function HeroQuoteCard() {
  const { city } = useCity();
  const sample = useCountUp(city.sample);
  const rate = useCountUp(city.rate);
  const localFmt = new Intl.NumberFormat(city.locale, { maximumFractionDigits: 0 });
  return (
    <div className="w-[200px] rounded-[16px] bg-white p-4 text-ink shadow-lift ring-1 ring-hair">
      <span className="eyebrow block text-muted">Local request</span>
      <span className="tabular mt-0.5 block text-[24px] font-extrabold leading-tight tracking-[-0.02em]">
        {city.symbol}
        {localFmt.format(sample)}
      </span>
      <div className="mt-3 border-t border-hair pt-3">
        <span className="eyebrow block text-muted">You pay</span>
        <span className="tabular mt-0.5 block text-[24px] font-extrabold leading-tight tracking-[-0.02em]">
          ${usdFmt.format(sample / rate)}
        </span>
      </div>
      <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-teal-soft px-3 py-1.5 text-[12px] font-semibold text-teal-on">
        <span className="h-1.5 w-1.5 rounded-full bg-teal-on/70" />
        {city.rail}
      </span>
    </div>
  );
}
