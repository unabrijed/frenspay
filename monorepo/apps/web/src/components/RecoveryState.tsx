'use client';

import type { ReactNode } from 'react';
import s from './recovery.module.css';

/** Recovery stays available without icon fonts, wallet hooks, or other app services. */
export function RecoveryState({ title, description, actionLabel, onAction, busy = false, children }: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  return <section className={s.recovery} aria-label={title}>
    <div className={s.art} aria-hidden="true">
      <svg width="156" height="112" viewBox="0 0 156 112" fill="none">
        <path d="M30 83Q78 103 126 83" stroke="#dbb88b" strokeWidth="2" strokeLinecap="round" />
        <rect x="12" y="24" width="52" height="56" rx="19" fill="#f8cba0" transform="rotate(-9 38 52)" />
        <rect x="92" y="24" width="52" height="56" rx="19" fill="#4e6d6a" transform="rotate(9 118 52)" />
        <path d="M49 51H67M89 51H107" stroke="#2b3131" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 6" />
        <circle cx="78" cy="51" r="16" fill="#fdf3dc" />
        <path d="M83 47a7 7 0 1 0 1 7M83 42v6h-6" stroke="#b94f2b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
    <p className={s.eyebrow}>A little pause</p>
    <h1 className={s.title}>{title}</h1>
    <p className={s.description} role="alert">{description}</p>
    <button className={s.primary} onClick={onAction} disabled={busy}>{busy ? 'Trying again…' : actionLabel}</button>
    {children && <div className={s.secondary}>{children}</div>}
  </section>;
}

/** Local errors keep the relevant form and its entered values in view. */
export function InlineFailure({ children }: { children: ReactNode }) {
  return <div className={s.inline} role="alert">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" /><path d="M10 5.5v5M10 14h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
    <div>{children}</div>
  </div>;
}
