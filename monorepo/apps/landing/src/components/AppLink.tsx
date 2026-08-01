'use client';

// AppLink — a link into the web app that carries the referral across the origin boundary.
//
// landing and the app are different origins, so they have separate localStorage: this link is the
// ONLY way a cached ref reaches the signup screen. A visitor who cached @asha weeks ago and returns
// to a bare URL still arrives at the app with ?ref=@asha, where its own entry gate re-stashes it.
// Only handles are forwarded — a member's 8-char code is not a handle and would 403 the invite gate.

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { isHandle, readRef } from './ref';

// Static export inlines this at build time — set NEXT_PUBLIC_APP_URL in Vercel / .env.local.
const APP = process.env.NEXT_PUBLIC_APP_URL ?? '#';

export function AppLink({ className, children }: { className?: string; children: ReactNode }) {
  // Effect, not an initializer: localStorage doesn't exist during the static render and reading it
  // inline would mismatch hydration. The href starts bare and gains the ref on mount.
  const [href, setHref] = useState(APP);
  useEffect(() => {
    const ref = readRef();
    if (isHandle(ref) && APP !== '#') setHref(`${APP}/?ref=${encodeURIComponent(ref)}`);
  }, []);
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
