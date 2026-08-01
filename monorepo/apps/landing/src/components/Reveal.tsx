'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/* One entrance per section. Children marked `.stag` with an inline --i
   cascade off this same trigger — see globals.css.

   The variant picks the choreography. Six sections all doing the identical
   fade-up is what made the page read as a template, so each one now arrives
   its own way: `wipe` rises the headline a word at a time, `split` closes the
   comparison columns in from opposite edges, `scale` pops the cards. */
export function Reveal({
  children,
  className = '',
  variant,
}: {
  children: ReactNode;
  className?: string;
  variant?: 'wipe' | 'split' | 'scale' | 'wipe scale' | 'wipe split';
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
