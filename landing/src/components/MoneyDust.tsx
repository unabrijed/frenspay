import type { CSSProperties } from 'react';

import { mulberry32 } from './rand';

/* The hero QR's stray pixels, escaped and drifting the length of the page —
   so the signature motif is present the whole way down instead of only in the
   first screen. Three layers at different parallax depths; each pixel also
   drifts on its own clock, so the field never resolves into a pattern.

   Kept to texture, not decoration: everything sits under 22% opacity in the
   one brand colour that reads on cream and on the dark sections alike. */
type Speck = { x: number; y: number; s: number; o: number; dur: number; d: number; dx: number; dy: number };

// Nearest layer first: below `lg` only the first survives (see globals.css).
const DEPTHS = [140, 310, 520] as const;
const COUNTS = [26, 18, 16] as const;

function layers() {
  const rnd = mulberry32(20260801);
  return DEPTHS.map((depth, li) => {
    const near = li === 0;
    const px: Speck[] = Array.from({ length: COUNTS[li] }, () => ({
      x: rnd() * 100,
      // Spread past the bottom edge: the parallax pulls the field upward, so
      // starting flush at 100% would empty the lower half on a long scroll.
      y: rnd() * 132 - 6,
      s: (near ? 4 : 3) + rnd() * (near ? 4 : 3),
      o: 0.06 + rnd() * (near ? 0.16 : 0.1),
      dur: 7 + rnd() * 8,
      d: rnd() * 9,
      dx: Math.round((rnd() - 0.5) * 26),
      dy: Math.round((rnd() - 0.5) * 22),
    }));
    return { depth, px };
  });
}

const LAYERS = layers();

export function MoneyDust() {
  return (
    <div className="dust" aria-hidden>
      {LAYERS.map((layer) => (
        <div key={layer.depth} className="dust-layer" style={{ '--depth': layer.depth } as CSSProperties}>
          {layer.px.map((p, i) => (
            <span
              key={i}
              style={
                {
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  width: `${p.s}px`,
                  height: `${p.s}px`,
                  opacity: p.o,
                  '--dur': `${p.dur}s`,
                  '--d': `${p.d}s`,
                  '--dx': `${p.dx}px`,
                  '--dy': `${p.dy}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
