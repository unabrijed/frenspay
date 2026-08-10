'use client';

// ui.tsx — the console's entire component kit in one file: table primitives, badges, buttons,
// confirm dialog, banners, and the tiny format helpers every page shares. Dense-workstation on
// purpose (13px rows, tabular numbers, raw state names) — this is the operator's tool, not the
// consumer app.
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ApiError } from '@/services/api';

/* ---- format helpers ---- */

/** Money arrives from the API as a canonical decimal string (docs/01 § Money & decimals). Printing
 *  is the one place it may become a `number` — so the parse lives here, once, and nowhere else. */
export const usd = (n: string | number) =>
  (typeof n === 'string' ? Number(n) : n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });

export const at = (iso: string) => new Date(iso).toLocaleString();

export function relTime(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** Raw order-state color classes (mirrors the stateColor logic the web admin page used). */
export function stateClass(state: string, resolution?: string | null): string {
  if (state === 'failed' || resolution === 'under_review') return 'text-danger';
  if (resolution) return 'text-accent';
  if (state === 'completed') return 'text-teal';
  if (state === 'refunded') return 'text-muted';
  return 'text-ink';
}

export function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.code.replaceAll('_', ' ');
  return e instanceof Error && e.message ? e.message : 'Something went wrong.';
}

/* ---- data loading: poll a fetcher, surface 403 as denied ---- */

export function usePoll<T>(fetcher: () => Promise<T>, intervalMs = 8000) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await fetcher());
      setErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setDenied(true);
      else setErr(errMessage(e));
    }
  }, [fetcher]);

  useEffect(() => {
    void reload();
    if (intervalMs <= 0) return;
    const t = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(t);
  }, [reload, intervalMs]);

  return { data, err, denied, reload };
}

/* ---- keyset pagination: first page on mount, Load more appends ---- */

export function usePaged<T>(fetcher: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(
    async (from?: string) => {
      setBusy(true);
      try {
        const page = await fetcher(from);
        setItems((prev) => (from ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setErr(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) setDenied(true);
        else setErr(errMessage(e));
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    },
    [fetcher],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { items, cursor, busy, loaded, err, denied, more: () => void load(cursor) };
}

/* ---- layout blocks ---- */

export function PageHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-[20px] font-bold tracking-tight">{title}</h1>
      {sub ? <p className="mt-0.5 text-[13px] text-muted">{sub}</p> : null}
    </header>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-7 text-[12px] font-semibold uppercase tracking-wide text-muted">{children}</h2>;
}

export function Denied() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-[18px] font-bold">Not authorized</p>
      <p className="mt-2 max-w-sm text-[13px] text-muted">
        This console is for the fpay operator. Your account doesn&apos;t carry the admin role.
      </p>
    </div>
  );
}

export function ErrorBanner({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">{msg}</p>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="py-8 text-center text-[13px] text-muted">{text}</p>;
}

export function Spinner() {
  return <p className="py-8 text-center text-[13px] text-muted">Loading…</p>;
}

/* ---- table primitives ---- */

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-hair bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-hair text-left">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

/** Fixed-tone status chip. */
export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'muted'; children: ReactNode }) {
  const tones = {
    ok: 'bg-teal-soft text-teal-on',
    warn: 'bg-accent-soft text-accent-deep',
    danger: 'bg-danger/10 text-danger',
    muted: 'bg-surface-high text-muted',
  } as const;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/* ---- actions ---- */

export function Btn({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-deep',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'border border-outline bg-surface text-ink hover:bg-surface-low',
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

/** "Load more" keyset pagination footer. */
export function LoadMore({ cursor, busy, onMore }: { cursor?: string; busy: boolean; onMore: () => void }) {
  if (!cursor) return null;
  return (
    <div className="mt-3 flex justify-center">
      <Btn onClick={onMore} disabled={busy}>
        {busy ? 'Loading…' : 'Load more'}
      </Btn>
    </div>
  );
}

/* ---- confirm dialog (native <dialog>-free, plain fixed overlay) ---- */

export interface Confirm {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}

export function ConfirmDialog({ confirm, onClose }: { confirm: Confirm | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBusy(false);
    setErr(null);
  }, [confirm]);

  if (!confirm) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-hair bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[15px] font-bold">{confirm.title}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{confirm.body}</p>
        {err ? <p className="mt-2 text-[12px] text-danger">{err}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn
            variant={confirm.danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setErr(null);
              confirm
                .onConfirm()
                .then(onClose)
                .catch((e: unknown) => {
                  setErr(errMessage(e));
                  setBusy(false);
                });
            }}
          >
            {busy ? 'Working…' : confirm.confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}
