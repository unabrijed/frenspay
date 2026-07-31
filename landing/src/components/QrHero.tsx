import type { ReactNode } from 'react';

import { HeroQuoteCard } from './HeroQuoteCard';

// Decorative pixel-QR — deliberately not scannable (aria-hidden, no scan CTA).
// Upgrade path once DEMO_URL is live: generate a real matrix at build time
// (`qrcode` devDep, ECC-H) and keep the dissolve away from the finder corners.
const N = 21; // modules per side
const M = 12; // px per module

// Seeded PRNG so the scatter is identical on server, client, and every build.
// Never swap for Math.random()/Date.now() — static export + hydration depend on it.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FINDERS = [
  [0, 0],
  [14, 0],
  [0, 14],
] as const;

type Px = { x: number; y: number; o: number; terra: boolean; s?: number };

function qrPixels(): Px[] {
  const rnd = mulberry32(20260731);
  const inFinderZone = (x: number, y: number) =>
    FINDERS.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  // Filled cells of a finder: the 7×7 outer ring + the 3×3 core.
  const isFinderCell = (x: number, y: number) =>
    FINDERS.some(([fx, fy]) => {
      const dx = x - fx;
      const dy = y - fy;
      if (dx < 0 || dx > 6 || dy < 0 || dy > 6) return false;
      return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    });

  const px: Px[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const finder = isFinderCell(x, y);
      if (!finder && (inFinderZone(x, y) || rnd() > 0.45)) continue;
      const terra = finder || rnd() < 0.15;
      const t = Math.max(0, (x - 12) / 8); // dissolve strength: 0 on the left → 1 at the right edge
      if (t > 0 && rnd() < t * 0.5) continue; // some modules are already gone
      px.push({
        x: x * M + t * (6 + rnd() * 52),
        y: y * M + (rnd() - 0.5) * t * 30,
        o: 1 - t * (0.3 + rnd() * 0.5),
        terra,
      });
    }
  }
  // Stray pixels drifting off the right edge, toward the rail.
  for (let i = 0; i < 22; i++) {
    px.push({
      x: N * M + rnd() * 66,
      y: rnd() * (N * M - 8),
      o: 0.1 + rnd() * 0.35,
      terra: rnd() < 0.3,
      s: 3 + rnd() * 6,
    });
  }
  return px;
}

const PIXELS = qrPixels();

export function QrHero() {
  return (
    <div className="flex flex-col items-center gap-10 lg:flex-row lg:gap-8">
      <div aria-hidden className="relative w-full max-w-[280px] shrink-0 overflow-hidden sm:max-w-[320px]">
        <svg viewBox="0 0 330 252" className="w-full">
          {PIXELS.map((p, i) => (
            <rect
              key={i}
              x={p.x}
              y={p.y}
              width={p.s ?? M - 2}
              height={p.s ?? M - 2}
              rx="2.5"
              opacity={p.o}
              fill={p.terra ? 'var(--color-terra)' : 'var(--color-ink)'}
            />
          ))}
        </svg>
        <span className="glint" />
      </div>
      <Rail />
    </div>
  );
}

function Rail() {
  return (
    <div className="relative flex flex-col gap-6">
      <span aria-hidden className="absolute bottom-16 left-[13px] top-4 border-l-2 border-dashed border-terra/25" />
      <Step n={1}>
        <div className="grain brand-gradient w-fit rounded-[16px] px-4 py-3 text-white shadow-btn">
          <span className="eyebrow block text-peach/80">USD balance</span>
          <span className="tabular text-[18px] font-extrabold tracking-[-0.01em]">$1,240.50</span>
        </div>
      </Step>
      <Step n={2}>
        <div className="flex w-fit items-center gap-2.5 rounded-[16px] bg-white px-4 py-3 shadow-tactile ring-1 ring-hair">
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
      <Step n={3}>
        <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-peach px-3.5 py-2 text-[13px] font-semibold text-terra">
          <span className="h-1.5 w-1.5 rounded-full bg-terra" />
          Rate locked
        </span>
      </Step>
      <Step n={4}>
        <span className="block pt-1 text-[14px] font-semibold">Merchant paid</span>
        <div className="mt-3">
          <HeroQuoteCard />
        </div>
      </Step>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="relative flex items-start gap-4">
      <span className="z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra text-[13px] font-semibold text-white ring-4 ring-canvas">
        {n}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
