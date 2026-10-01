'use client';

// Payout providers — the per-corridor disbursement ladder (docs/23). This screen is deliberately
// SUBTRACT-only: disable (the kill switch), re-enable what already has credentials, and reorder
// priority. Rows come from seed/SQL and credentials from server env, so turning on a NEW
// money-mover is a deploy, never a click; an enabled row whose credential doesn't resolve is inert
// and flagged here. Every change lands in the audit trail.
import { useCallback, useState } from 'react';

import type { AdminPayoutProvider } from '@fpay/shared';

import { api } from '@/services/api';
import {
  Badge,
  Btn,
  Confirm,
  ConfirmDialog,
  Denied,
  EmptyState,
  ErrorBanner,
  PageHead,
  Spinner,
  Table,
  Td,
  usePoll,
} from '@/components/ui';

export default function Providers() {
  const fetchList = useCallback(() => api.payoutProviders(), []);
  const { data, err, denied, reload } = usePoll(fetchList, 0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  if (denied) return <Denied />;

  // ↑/↓ swap priorities with the neighbour (lower number = tried first). Two audited writes; if
  // the pair somehow share a priority, nudge instead so the order visibly changes.
  const move = async (p: AdminPayoutProvider, dir: -1 | 1, list: AdminPayoutProvider[]) => {
    const i = list.findIndex((x) => x.id === p.id);
    const other = list[i + dir];
    if (!other || busy) return;
    setBusy(true);
    try {
      const a = p.priority === other.priority ? other.priority + dir : other.priority;
      await api.payoutProviderUpdate(p.id, { priority: a });
      await api.payoutProviderUpdate(other.id, { priority: p.priority });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const toggle = (p: AdminPayoutProvider) =>
    setConfirm({
      title: p.enabled ? `Disable ${p.id}` : `Enable ${p.id}`,
      body: p.enabled
        ? 'New orders stop selecting this provider immediately. Orders already bound to it keep polling it until they settle. Disabling never abandons in-flight money.'
        : p.hasCredentials
          ? 'New orders on its rail can select this provider immediately.'
          : 'This row has NO resolvable credential, so enabling it changes nothing until the key ships in a deploy. It will sit enabled but inert.',
      confirmLabel: p.enabled ? 'Disable' : 'Enable',
      onConfirm: async () => {
        await api.payoutProviderUpdate(p.id, { enabled: !p.enabled });
        await reload();
      },
    });

  return (
    <>
      <PageHead title="Payout providers" sub="Who settles each rail's fiat leg, in what order: the corridor disbursement ladder" />
      <ErrorBanner msg={err} />

      {!data ? (
        <Spinner />
      ) : data.providers.length === 0 ? (
        <EmptyState text="No provider rows. Apply the registry migrations; do not reset a funded database." />
      ) : (
        <Table head={['Provider', 'Adapter', 'Rail', 'Priority', 'Creds', 'Status', '']}>
          {data.providers.map((p, i) => (
            <tr key={p.id} className="hover:bg-surface-low">
              <Td className="font-medium">{p.id}</Td>
              <Td className="text-muted">{p.adapter}</Td>
              <Td>
                <Badge tone="muted">{p.payoutMethod}</Badge>
              </Td>
              <Td>
                <span className="mr-2 tabular-nums">{p.priority}</span>
                <Btn disabled={busy || i === 0} onClick={() => move(p, -1, data.providers)}>
                  ↑
                </Btn>{' '}
                <Btn disabled={busy || i === data.providers.length - 1} onClick={() => move(p, 1, data.providers)}>
                  ↓
                </Btn>
              </Td>
              <Td>
                <Badge tone={p.hasCredentials ? 'ok' : 'warn'}>{p.hasCredentials ? 'resolved' : 'missing'}</Badge>
              </Td>
              <Td>
                <Badge tone={p.sandboxOnly ? 'muted' : p.enabled ? (p.hasCredentials ? 'ok' : 'warn') : 'muted'}>
                  {p.sandboxOnly ? 'sandbox only · unavailable' : p.enabled ? (p.hasCredentials ? 'enabled' : 'enabled · inert') : 'disabled'}
                </Badge>
              </Td>
              <Td>
                <Btn disabled={p.sandboxOnly && !p.enabled} variant={p.enabled ? 'danger' : undefined} onClick={() => toggle(p)}>
                  {p.enabled ? 'Disable' : 'Enable'}
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
