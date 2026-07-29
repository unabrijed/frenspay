import type { ReactNode } from 'react';

const variants = {
  ink: 'bg-ink text-white',
  white: 'bg-white text-ink',
  terra: 'bg-terra text-white shadow-btn',
};

const circles = {
  ink: 'bg-peach text-terra-deep',
  white: 'bg-peach text-terra-deep',
  terra: 'bg-white text-terra',
};

export function Pill({
  href,
  submit,
  variant = 'ink',
  className = '',
  children,
}: {
  href?: string;
  submit?: boolean;
  variant?: keyof typeof variants;
  className?: string;
  children: ReactNode;
}) {
  const cls = `group inline-flex items-center gap-2.5 rounded-full py-1.5 pl-5 pr-1.5 text-[16px] font-semibold tracking-[-0.01em] transition-transform duration-300 ease-soft hover:-translate-y-0.5 ${variants[variant]} ${className}`;
  const inner = (
    <>
      {children}
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-300 ease-soft group-hover:translate-x-0.5 ${circles[variant]}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </>
  );
  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <button type={submit ? 'submit' : 'button'} className={cls}>
      {inner}
    </button>
  );
}
