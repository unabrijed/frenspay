'use client';

import { useCallback, useEffect, useState } from 'react';

/* Pulls an element toward the cursor while the cursor is over it. Writes to
   --mx/--my; the `translate` property in .magnetic does the rest, which keeps
   this off `transform` so it composes with the hover lift and the press.

   Returns a callback ref rather than a RefObject so one hook can attach to
   either the <a> or the <button> branch of a control without a cast.

   Pointer-only and motion-preference-aware: on touch there is no cursor to
   follow, and the whole effect is decoration a reduced-motion user opted out
   of. Both checks run once, when the node lands, rather than per event. */
export function useMagnetic(strength = 0.3) {
  const [el, setEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!el) return;
    if (!matchMedia('(hover: hover)').matches) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${(e.clientX - (r.left + r.width / 2)) * strength}px`);
        el.style.setProperty('--my', `${(e.clientY - (r.top + r.height / 2)) * strength}px`);
      });
    };
    const reset = () => {
      cancelAnimationFrame(raf);
      el.style.setProperty('--mx', '0px');
      el.style.setProperty('--my', '0px');
    };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', reset);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', reset);
    };
  }, [el, strength]);

  return useCallback((node: HTMLElement | null) => setEl(node), []);
}
