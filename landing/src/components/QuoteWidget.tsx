'use client';

import { useEffect, useRef, useState } from 'react';

// Demo math only — live quotes come from the app.
const RATE = 83.2; // ₹ per $1
const LOCK_SECONDS = 45;

const inrFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const R = 24;
const C = 2 * Math.PI * R;

export function QuoteWidget() {
  const [raw, setRaw] = useState('20');
  const [secs, setSecs] = useState(LOCK_SECONDS);
  const [refreshed, setRefreshed] = useState(false);
  const ticked = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      ticked.current = true;
      setSecs((s) => (s <= 1 ? LOCK_SECONDS : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // The lock wrapped around: pulse the rate row briefly. Skip the initial 45.
  useEffect(() => {
    if (secs !== LOCK_SECONDS || !ticked.current) return;
    setRefreshed(true);
    const t = setTimeout(() => setRefreshed(false), 1500);
    return () => clearTimeout(t);
  }, [secs]);

  const amount = Math.min(1000, Math.max(0, parseFloat(raw) || 0));
  const fee = amount === 0 ? 0 : Math.max(0.05, amount * 0.005);
  const urgent = secs <= 10;

  return (
    <div className="mx-auto w-full max-w-[560px] rounded-[24px] bg-white p-6 shadow-lift ring-1 ring-hair sm:p-8">
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
              className="tabular w-full bg-transparent text-[32px] font-bold tracking-[-0.02em] outline-none placeholder:text-muted/40"
              placeholder="20"
            />
          </span>
        </label>

        <div className="flex flex-col items-center gap-1">
          <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
            <circle cx="28" cy="28" r={R} fill="none" stroke="#ffdad3" strokeWidth="4" />
            <circle
              cx="28"
              cy="28"
              r={R}
              fill="none"
              stroke={urgent ? '#c84b34' : '#a6341f'}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - secs / LOCK_SECONDS)}
              transform="rotate(-90 28 28)"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
            <text
              x="28"
              y="32"
              textAnchor="middle"
              fontSize="14"
              fontWeight="700"
              fill={urgent ? '#c84b34' : '#1e1b19'}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {secs}
            </text>
          </svg>
          <span className="eyebrow text-muted/80">rate lock</span>
        </div>
      </div>

      <div className="mt-6">
        <span className="eyebrow text-muted">Merchant gets</span>
        <div className="tabular mt-0.5 text-[40px] font-bold leading-tight tracking-[-0.02em]">
          ₹{inrFmt.format(amount * RATE)}
        </div>
      </div>

      <dl className="mt-5 divide-y divide-hair border-t border-hair text-[15px]">
        <div className={`flex justify-between py-3 ${refreshed ? 'flash-peach -mx-2 rounded-lg px-2' : ''}`}>
          <dt className="text-muted">
            Rate {refreshed && <span className="ml-2 text-[12px] font-semibold text-terra">refreshed</span>}
          </dt>
          <dd className="tabular font-medium">₹{RATE.toFixed(2)} / $1 · locked</dd>
        </div>
        <div className="flex justify-between py-3">
          <dt className="text-muted">Fee</dt>
          <dd className="tabular font-medium">${usdFmt.format(fee)}</dd>
        </div>
        <div className="flex justify-between py-3">
          <dt className="text-muted">Total from balance</dt>
          <dd className="tabular font-semibold">${usdFmt.format(amount + fee)}</dd>
        </div>
        <div className="flex justify-between py-3">
          <dt className="text-muted">Arrival</dt>
          <dd className="font-semibold text-teal">Instant</dd>
        </div>
      </dl>

      <p className="mt-4 text-[12px] text-muted/80">Demo rates. Live quotes in the app.</p>
    </div>
  );
}
