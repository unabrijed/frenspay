'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getApiMode } from '@/services/apiMode';
import type { ApiMode } from '@/services/envConfig';

import { EnvSwitch } from './EnvSwitch';
import { SignOut } from './Providers';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/campaign', label: 'Simulation beta' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/merchants', label: 'Partners' },
  { href: '/providers', label: 'Payout providers' },
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

  // Only for the red rail below — the switch itself owns its own copy (EnvSwitch). null until
  // mounted: the mode lives in localStorage, and rendering a guess server-side would paint the
  // stage rail over a prod session for a frame. Absent for a frame beats mislabelled for a frame.
  const [mode, setMode] = useState<ApiMode | null>(null);
  useEffect(() => setMode(getApiMode()), []);

  return (
    <nav
      className={`flex w-44 shrink-0 flex-col gap-0.5 border-r p-3 ${
        mode === 'prod' ? 'border-danger bg-danger/5' : 'border-hair bg-surface-low'
      }`}
    >
      <p className="mb-3 px-2 text-[15px] font-bold tracking-tight">
        fpay <span className="text-accent">admin</span>
      </p>
      <div className="mb-3 empty:mb-0">
        <EnvSwitch />
      </div>
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
    </nav>
  );
}
