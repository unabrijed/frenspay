'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';

import { useCity } from './CityContext';
import { HeroQuoteCard } from './HeroQuoteCard';
import { M, PIXELS, QR_H, QR_W, type Px } from './qrGeometry';

function Rect({ p }: { p: Px }) {
  return (
    <rect
      x={p.x}
      y={p.y}
      width={M - 2}
      height={M - 2}
      rx="2.5"
      opacity={p.o}
      fill={p.terra ? 'var(--color-terra)' : 'var(--color-ink)'}
      className="qr-px"
      style={{ '--d': `${p.d}ms`, '--dx': `${p.dx}px`, '--dy': `${p.dy}px` } as CSSProperties}
    />
  );
}

export function QrCode() {
  const { city } = useCity();
  // Remounting the svg replays the assembly. The counter (rather than the city
  // code) keys it so the FIRST paint is a plain mount running the full load
  // wave — only later changes get the compressed .qr-swap timing.
  const [swaps, setSwaps] = useState(0);
  const prev = useRef(city.code);

  useEffect(() => {
    if (prev.current === city.code) return;
    prev.current = city.code;
    setSwaps((s) => s + 1);
  }, [city.code]);

  const track = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return; // a tap would just leave it stuck off-centre
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--px', String((e.clientX - r.left - r.width / 2) / r.width));
    e.currentTarget.style.setProperty('--py', String((e.clientY - r.top - r.height / 2) / r.height));
  };
  const release = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty('--px', '0');
    e.currentTarget.style.setProperty('--py', '0');
  };

  return (
    <div
      aria-hidden
      onPointerMove={track}
      onPointerLeave={release}
      className="qr-mask relative w-full max-w-[280px] shrink-0 sm:max-w-[320px]"
    >
      <svg key={swaps} viewBox={`0 0 ${QR_W} ${QR_H}`} className={`w-full ${swaps ? 'qr-swap' : ''}`}>
        <g className="qr-body">
          {PIXELS.map((p, i) => (
            <Rect key={i} p={p} />
          ))}
        </g>
      </svg>
    </div>
  );
}

/* The four beats of a payment. On desktop these are scrubbed by scroll (see
   .scrub / .rail-steps in globals.css) — the sequence is the story, so it
   plays at the reader's pace rather than on a timer they may never see. The
   --d delays below are what a phone, and any browser without scroll
   timelines, falls back to. */
export function Rail() {
  return (
    <div className="rail-steps relative flex flex-col gap-6">
      <span
        aria-hidden
        className="rail-line absolute bottom-16 left-[13px] top-4 border-l-2 border-dashed border-terra/25"
      />
      <Step n={1} delay={800}>
        <div className="grain brand-gradient w-fit rounded-[16px] px-4 py-3 text-white shadow-btn">
          {/* White, not peach: on the gradient's light stop peach is ~3.6:1.
              The hierarchy here comes from size and weight, not opacity. */}
          <span className="eyebrow block text-white">USD balance</span>
          <span className="tabular text-[18px] font-extrabold tracking-[-0.01em]">$1,240.50</span>
        </div>
      </Step>
      <Step n={2} delay={950}>
        <div className="flex w-fit items-center gap-2.5 rounded-[16px] bg-white px-4 py-3 text-ink shadow-tactile ring-1 ring-hair">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            className="text-terra"
            aria-hidden
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
          </svg>
          <span className="text-[14px] font-semibold">Scan any QR</span>
        </div>
      </Step>
      <Step n={3} delay={1100}>
        <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-peach px-3.5 py-2 text-[13px] font-semibold text-terra">
          <span className="h-1.5 w-1.5 rounded-full bg-terra" />
          Rate locked
        </span>
      </Step>
      <Step n={4} delay={1250}>
        <span className="block pt-1 text-[14px] font-semibold">Merchant paid</span>
        <div className="mt-3">
          <HeroQuoteCard />
        </div>
      </Step>
    </div>
  );
}

function Step({ n, delay, children }: { n: number; delay: number; children: ReactNode }) {
  return (
    <div
      className="animate-blur-fade-up scrub relative flex items-start gap-4"
      style={{ '--d': `${delay}ms` } as CSSProperties}
    >
      <span className="z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra text-[13px] font-semibold text-white ring-4 ring-canvas">
        {n}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
