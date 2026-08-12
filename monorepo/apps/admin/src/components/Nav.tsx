'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SignOut } from './Providers';

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
  return (
    <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-hair bg-surface-low p-3">
      <p className="mb-3 px-2 text-[15px] font-bold tracking-tight">
        fpay <span className="text-accent">admin</span>
      </p>
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
