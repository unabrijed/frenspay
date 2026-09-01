'use client';

// Risk — every screened money-movement action (all decisions, not just flags; the overview
// already shows the non-allow subset). Keyset-paginated.
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
  usd,
  usePaged,
} from '@/components/ui';

export default function Risk() {
  const fetchPage = useCallback(
    (cursor?: string) => api.riskEvents(cursor).then((r) => ({ items: r.events, nextCursor: r.nextCursor })),
    [],
  );
  const { items, cursor, busy, loaded, err, denied, more } = usePaged(fetchPage);

  if (denied) return <Denied />;
  return (
    <>
      <PageHead title="Risk events" sub="One row per screened action: decision, score, counterparty" />
      <ErrorBanner msg={err} />
      {!loaded ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState text="No risk events yet." />
      ) : (
        <Table head={['User', 'Kind', 'Amount', 'Decision', 'Score', 'Counterparty', 'Reason', 'When']}>
          {items.map((r) => (
            <tr key={r.id} className="hover:bg-surface-low">
              <Td>
                <Who handle={r.userHandle} email={r.userEmail} />
              </Td>
              <Td>{r.kind}</Td>
              <Td className="whitespace-nowrap">{r.amountUsdc != null ? usd(r.amountUsdc) : '—'}</Td>
              <Td>
                <Badge tone={r.decision === 'block' ? 'danger' : r.decision === 'review' ? 'warn' : 'ok'}>
                  {r.decision}
                </Badge>
              </Td>
              <Td>{r.score}</Td>
              <Td className="max-w-[180px] truncate text-muted">{r.counterparty ?? '—'}</Td>
              <Td className="max-w-[240px] truncate text-muted">{r.reason ?? '—'}</Td>
              <Td className="whitespace-nowrap text-muted">{at(r.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <LoadMore cursor={cursor} busy={busy} onMore={more} />
    </>
  );
}
