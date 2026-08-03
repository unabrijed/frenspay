'use client';

// Denylist — sanctions/abuse blocks on addresses and handles. Adding an entry blocks money
// movement immediately (compliance checks read this table on every screened action); removal
// confirms first. Both actions land in the audit trail.
import { useCallback, useState, type FormEvent } from 'react';

import { api } from '@/services/api';
import {
  at,
  Badge,
  Btn,
  Confirm,
  ConfirmDialog,
  Denied,
  EmptyState,
  ErrorBanner,
  errMessage,
  PageHead,
  Spinner,
  Table,
  Td,
  usePoll,
} from '@/components/ui';

export default function Denylist() {
  const fetchList = useCallback(() => api.denylist(), []);
  const { data, err, denied, reload } = usePoll(fetchList, 0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [kind, setKind] = useState<'handle' | 'address'>('handle');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  if (denied) return <Denied />;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setFormErr(null);
    try {
      await api.denylistAdd({ kind, value: value.trim(), reason: reason.trim() || undefined });
      setValue('');
      setReason('');
      await reload();
    } catch (e2) {
      setFormErr(errMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Denylist" sub="Blocked addresses and handles, checked on every screened money movement" />
      <ErrorBanner msg={err} />

      {/* Add form — blocking a bad actor is the #1 real admin action, so it sits on top. */}
      <form onSubmit={add} className="mb-5 flex flex-wrap items-end gap-2 rounded-lg border border-hair bg-surface p-3">
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'handle' | 'address')}
            className="h-8 rounded-md border border-outline bg-surface px-2 text-[13px] font-normal normal-case tracking-normal text-ink"
          >
            <option value="handle">handle</option>
            <option value="address">address</option>
          </select>
        </label>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Value
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === 'handle' ? '@handle' : 'solana address'}
            className="h-8 rounded-md border border-outline bg-surface px-2 text-[13px] font-normal normal-case tracking-normal text-ink placeholder:text-muted/50"
          />
        </label>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Reason
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="why (optional)"
            className="h-8 rounded-md border border-outline bg-surface px-2 text-[13px] font-normal normal-case tracking-normal text-ink placeholder:text-muted/50"
          />
        </label>
        <Btn type="submit" variant="danger" disabled={busy || !value.trim()}>
          {busy ? 'Blocking…' : 'Block'}
        </Btn>
        {formErr ? <p className="w-full text-[12px] text-danger">{formErr}</p> : null}
      </form>

      {!data ? (
        <Spinner />
      ) : data.entries.length === 0 ? (
        <EmptyState text="Denylist is empty." />
      ) : (
        <Table head={['Kind', 'Value', 'Reason', 'Added', '']}>
          {data.entries.map((d) => (
            <tr key={d.id} className="hover:bg-surface-low">
              <Td>
                <Badge tone="muted">{d.kind}</Badge>
              </Td>
              <Td className="max-w-[320px] truncate font-medium">{d.value}</Td>
              <Td className="max-w-[280px] truncate text-muted">{d.reason ?? '—'}</Td>
              <Td className="whitespace-nowrap text-muted">{at(d.createdAt)}</Td>
              <Td>
                <Btn
                  onClick={() =>
                    setConfirm({
                      title: `Unblock ${d.value}`,
                      body: 'Money movement involving this entry is allowed again immediately.',
                      confirmLabel: 'Unblock',
                      onConfirm: async () => {
                        await api.denylistRemove(d.id);
                        await reload();
                      },
                    })
                  }
                >
                  Remove
                </Btn>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
