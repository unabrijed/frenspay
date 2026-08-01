'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/* One entrance per section. Children marked `.stag` with an inline --i
   cascade off this same trigger — see globals.css.

   `wipe` rises the headline a word at a time and suppresses the slab move, so
   the section's own type carries the entrance. The `split` and `scale` variants
   went with the card layout they were built for: the page now has one section
   shape, so it does not need five ways of arriving. */
export function Reveal({
  children,
  className = '',
  variant,
}: {
  children: ReactNode;
  className?: string;
  variant?: 'wipe';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('in');
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} data-reveal={variant} className={`reveal ${className}`}>
      {children}
    </div>
  );
}
