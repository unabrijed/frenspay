'use client';

// Audit — the admin_actions trail: which admin did what to which target, newest first.
// Every write on this console lands here; the page itself is read-only by design.
import { useCallback } from 'react';

import { api } from '@/services/api';
import {
  at,
  Badge,
  Denied,
  EmptyState,
  ErrorBanner,
  LoadMore,
  PageHead,
  Spinner,
  Table,
  Td,
  Who,
  usePaged,
} from '@/components/ui';

const tone = (action: string) =>
  action.includes('reject') || action.includes('suspend') || action === 'denylist_add' ? 'danger'
  : action.includes('approve') || action === 'merchant_reinstate' ? 'ok'
  : 'muted';

export default function Audit() {
  const fetchPage = useCallback(
    (cursor?: string) => api.actions(cursor).then((r) => ({ items: r.actions, nextCursor: r.nextCursor })),
    [],
  );
  const { items, cursor, busy, loaded, err, denied, more } = usePaged(fetchPage);

  if (denied) return <Denied />;
  return (
    <>
      <PageHead title="Audit trail" sub="Every admin write: who did what to which target" />
      <ErrorBanner msg={err} />
      {!loaded ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState text="No admin actions yet." />
      ) : (
        <Table head={['Admin', 'Action', 'Target', 'Note', 'When']}>
          {items.map((a) => (
            <tr key={a.id} className="hover:bg-surface-low">
              <Td>
                <Who handle={a.adminHandle} email={a.adminEmail} />
              </Td>
              <Td>
                <Badge tone={tone(a.action)}>{a.action}</Badge>
              </Td>
              <Td className="max-w-[280px] truncate text-muted">
                {a.targetKind}:{a.targetId}
              </Td>
              <Td className="max-w-[280px] truncate text-muted">{a.note ?? '—'}</Td>
              <Td className="whitespace-nowrap text-muted">{at(a.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <LoadMore cursor={cursor} busy={busy} onMore={more} />
    </>
  );
}
