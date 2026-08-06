'use client';

import { useState } from 'react';
import { useMotionValueEvent, useScroll } from 'framer-motion';

import { focusFList } from '@/lib/f-list';
import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

export function Navigation() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, 'change', (value) => {
    const next = value > 60;
    setScrolled((current) => (current === next ? current : next));
  });

  return (
    <header className={`site-nav safe-x ${scrolled ? 'is-scrolled' : ''}`}>
      <nav aria-label="Primary" className="site-nav-inner">
        <a className="brand-lockup" href="#top" aria-label="FrensPay, back to top">
          {/* The adjacent live text provides the accessible name. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" width="17" height="22" />
          <span>frenspay</span>
        </a>
        <div className="nav-actions">
          <a href="#fyi">fyi</a>
          <a
            href="#f-list"
            onClick={(event) => {
              event.preventDefault();
              focusFList();
            }}
          >
            {FRENSPAY_COPY.fList}
          </a>
        </div>
      </nav>
    </header>
  );
}
