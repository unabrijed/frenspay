'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';

import { useCity } from './CityContext';
import { HeroQuoteCard } from './HeroQuoteCard';
import { M, MATRIX_PIXELS, QR_H, QR_W, TRAIL_PIXELS, type Px } from './qrGeometry';

/* Two geometries, and the difference is forced by the scanner, not chosen for
   looks: measured against a decoder, the code only reads when its modules are
   FULL PITCH and touching. A 10px module on a 12px pitch never merges with its
   neighbour, so a decoder sees a dot grid and finds nothing; rx above 2 fails
   the same way once the render gets large enough.

   That lands somewhere better than the compromise it sounds like. The code is
   solid and continuous, and only what it sheds is discrete. */
function Rect({ p, code }: { p: Px; code?: boolean }) {
  const size = code ? M : M - 2;
  return (
    <rect
      x={code ? p.x : p.x + 1}
      y={code ? p.y : p.y + 1}
      width={size}
      height={size}
      rx={code ? '2' : '2.5'}
      opacity={p.o}
      fill={p.terra ? 'var(--color-terra)' : 'var(--color-ink)'}
      className="qr-px"
      style={{ '--d': `${p.d}ms`, '--dx': `${p.dx}px`, '--dy': `${p.dy}px` } as CSSProperties}
    />
  );
}

/* `trail={false}` once the particle field is up: the shed modules are what the
   canvas is drawing, so rendering both would double them. The code itself is
   never hidden, which is the whole point of it being a real QR. */
export function QrCode({ trail = true }: { trail?: boolean }) {
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
    <div onPointerMove={track} onPointerLeave={release} className="relative w-full max-w-[340px] shrink-0 sm:max-w-[420px]">
      {/* No mask over this element any more. The old .qr-mask faded from 55% of
          the width, which on a real code would erase a third of the payload;
          the trail's own quantized ramp is the dissolve now. */}
      <svg
        key={swaps}
        viewBox={`0 0 ${QR_W} ${QR_H}`}
        role="img"
        aria-label="QR code linking to the f list"
        className={`w-full ${swaps ? 'qr-swap' : ''}`}
      >
        <g className="qr-body">
          {MATRIX_PIXELS.map((p, i) => (
            <Rect key={i} p={p} code />
          ))}
          {trail ? TRAIL_PIXELS.map((p, i) => <Rect key={`t${i}`} p={p} />) : null}
        </g>
      </svg>
    </div>
  );
}

/* The live moment: what you hold, and what it turns into at this counter.

   This used to be four numbered steps with a dashed connector, which told the
   same story section 02 tells, at the same length, a screen earlier. The
   sequence belongs in 02, where there is room for it. What the hero keeps is
   the part that rewards watching: the balance, and a quote that moves when you
   switch cities. */
export function Rail() {
  return (
    <div className="rail-steps flex flex-col items-start gap-5">
      <div
        className="animate-blur-fade-up scrub grain brand-gradient w-fit rounded-[16px] px-5 py-4 text-white shadow-btn"
        style={{ '--d': '800ms' } as CSSProperties}
      >
        {/* White, not peach: on the gradient's light stop peach is ~3.6:1.
            The hierarchy here comes from size and weight, not opacity. */}
        <span className="eyebrow block text-white">Your balance</span>
        <span className="tabular text-[22px] font-extrabold tracking-[-0.01em]">$1,240.50</span>
      </div>

      <span
        aria-hidden
        className="animate-blur-fade-up scrub ml-6 h-8 w-px bg-hair"
        style={{ '--d': '950ms' } as CSSProperties}
      />

      <div className="animate-blur-fade-up scrub" style={{ '--d': '1100ms' } as CSSProperties}>
        <HeroQuoteCard />
      </div>
    </div>
  );
}
