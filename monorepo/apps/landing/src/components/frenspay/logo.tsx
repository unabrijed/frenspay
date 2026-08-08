import type { CSSProperties } from 'react';

import { LOCKUP } from '@/components/frenspay/logo-geometry';

// Inline SVG rather than <img src="…logo.svg">, because the dots and the curve
// each have to move independently and an <img> is a single opaque box. Geometry
// comes from brand/logo-lockup.svg via `yarn brand` — it is not authored here.
//
// Colour is `currentColor` throughout, so one component serves the terracotta
// header and any cream-on-dark placement without a second copy.
//
// `state` is deliberately local to wherever the logo sits: the submit button owns
// `joining`, the success line owns `success`. Nothing has to plumb form state up
// to the header.

export type LogoState = 'idle' | 'joining' | 'success';

export function FrensLogo({ state = 'idle', className }: { state?: LogoState; className?: string }) {
  return (
    <svg
      className={`fp-logo${className ? ` ${className}` : ''}`}
      data-state={state}
      viewBox={LOCKUP.viewBox}
      fill="none"
      aria-hidden="true"
    >
      {/* pathLength="1" normalises the draw-on to 0..1, so the entrance keyframes
          never have to know the curve's real length. */}
      <path
        className="fp-logo-link"
        d={LOCKUP.link}
        pathLength={1}
        stroke="currentColor"
        strokeWidth={LOCKUP.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {LOCKUP.dots.map((dot, i) => (
        <circle
          key={dot.cx}
          className={`fp-logo-dot fp-logo-dot-${i === 0 ? 'l' : 'r'}`}
          cx={dot.cx}
          cy={dot.cy}
          r={dot.r}
          fill="currentColor"
        />
      ))}
      {/* The bead rides the curve itself via offset-path, so the "something is
          passing between them" animation reuses the one geometry source instead
          of a hand-sampled copy of it. Painted in the surrounding surface colour
          so it reads as a highlight travelling along the link. */}
      <circle
        className="fp-logo-bead"
        r={LOCKUP.strokeWidth * 0.4}
        style={{ offsetPath: `path("${LOCKUP.link}")` } as CSSProperties}
      />
    </svg>
  );
}
