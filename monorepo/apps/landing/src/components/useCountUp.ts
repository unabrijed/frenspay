'use client';

import { useEffect, useRef, useState } from 'react';

/* Tweens a number when it changes. Starts AT the value so the server HTML and
   the first client render match — only later changes animate. */
export function useCountUp(value: number, ms = 400) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setDisplay(from + (value - from) * (1 - (1 - k) ** 3)); // easeOutCubic
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);

  return display;
}
