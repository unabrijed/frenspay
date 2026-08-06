'use client';

import type { MouseEvent } from 'react';

import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

export function V2Navigation({
  onFListClick,
  onFyiClick,
}: {
  onFListClick: () => void;
  onFyiClick: () => void;
}) {
  const join = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onFListClick();
  };

  const showFyi = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onFyiClick();
  };

  return (
    <header className="fp-nav">
      <nav className="fp-nav-inner" aria-label="Primary">
        <a className="fp-brand" href="#fp-v2-top" aria-label="FrensPay, back to top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" width="18" height="24" />
          <span>frenspay</span>
        </a>
        <div className="fp-nav-actions">
          <a className="fp-nav-fyi" href="#fp-v2-mystery" onClick={showFyi}>fyi</a>
          <a className="fp-nav-join" href="#fp-v2-flist" onClick={join}>
            {FRENSPAY_COPY.fList}
          </a>
        </div>
      </nav>
    </header>
  );
}
