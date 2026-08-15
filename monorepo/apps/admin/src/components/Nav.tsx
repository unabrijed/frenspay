'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getApiMode, PROD_AVAILABLE, setApiMode } from '@/services/apiMode';
import type { ApiMode } from '@/services/envConfig';

import { SignOut } from './Providers';
import { ConfirmDialog, type Confirm } from './ui';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/merchants', label: 'Merchants' },
  { href: '/providers', label: 'Providers' },
  { href: '/users', label: 'Users' },
  { href: '/risk', label: 'Risk' },
  { href: '/invites', label: 'Invites' },
  { href: '/denylist', label: 'Denylist' },
  { href: '/waitlist', label: 'F list' },
  { href: '/audit', label: 'Audit' },
] as const;

export function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' || path.startsWith('/orders') : path.startsWith(href));

  // null until mounted: the mode lives in localStorage, and rendering a guess server-side would
  // paint "STAGE" over a prod session for a frame. Absent for a frame beats mislabelled for a frame.
  const [mode, setMode] = useState<ApiMode | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  useEffect(() => setMode(getApiMode()), []);

  // Only the dangerous direction asks. Going back to stage is a de-escalation; making it modal too
  // would train the operator to dismiss the dialog that matters.
  const select = (next: ApiMode) => {
    if (next === mode) return;
    if (next === 'stage') return setApiMode('stage');
    setConfirm({
      title: 'Switch to production?',
      body: 'Every read and every write in this console will hit the live backend and real user data. The page reloads.',
      confirmLabel: 'Use production',
      danger: true,
      onConfirm: async () => setApiMode('prod'),
    });
  };

  return (
    <nav
      className={`flex w-44 shrink-0 flex-col gap-0.5 border-r p-3 ${
        mode === 'prod' ? 'border-danger bg-danger/5' : 'border-hair bg-surface-low'
      }`}
    >
      <p className="mb-3 px-2 text-[15px] font-bold tracking-tight">
        fpay <span className="text-accent">admin</span>
      </p>
      {PROD_AVAILABLE && mode ? (
        <div className="mb-3 flex gap-0.5 rounded-md border border-outline p-0.5">
          {(['stage', 'prod'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => select(m)}
              className={`flex-1 rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                mode !== m
                  ? 'text-muted hover:bg-surface-high'
                  : m === 'prod'
                    ? 'bg-danger text-white'
                    : 'bg-accent-soft text-accent-deep'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      ) : null}
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors ${
            active(l.href) ? 'bg-accent-soft font-semibold text-accent-deep' : 'text-muted hover:bg-surface-high'
          }`}
        >
          {l.label}
        </Link>
      ))}
      <SignOut />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </nav>
  );
}
