'use client';

// EnvSwitch.tsx — which backend this console is driving, and the control to change it.
//
// Lives in its own file, not in Nav, because Nav is a CHILD of Providers and Providers' gate returns
// early on every failure path — so the sidebar, and with it the only way to change environment, was
// unreachable from exactly the screens that needed it. An operator signed into the wrong backend was
// told "no profile on this environment" by a screen that named neither the environment nor offered a
// way off it; the fix was devtools. Now the gate renders this too.
import { useEffect, useState } from 'react';

import { getApiMode, PROD_AVAILABLE, setApiMode } from '@/services/apiMode';
import type { ApiMode } from '@/services/envConfig';

import { ConfirmDialog, type Confirm } from './ui';

export function EnvSwitch() {
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

  if (!PROD_AVAILABLE || !mode) return null;
  return (
    <>
      <div className="flex gap-0.5 rounded-md border border-outline p-0.5">
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
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
