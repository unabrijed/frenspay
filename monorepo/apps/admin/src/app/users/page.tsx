'use client';

// Users — read-only account directory: handle, KYC tier/status, role. Keyset-paginated.
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
  usePaged,
} from '@/components/ui';

export default function Users() {
  const fetchPage = useCallback(
    (cursor?: string) => api.users(cursor).then((r) => ({ items: r.users, nextCursor: r.nextCursor })),
    [],
  );
  const { items, cursor, busy, loaded, err, denied, more } = usePaged(fetchPage);

  if (denied) return <Denied />;
  return (
    <>
      <PageHead title="Users" sub="Every account: KYC tier gates money movement" />
      <ErrorBanner msg={err} />
      {!loaded ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState text="No users yet." />
      ) : (
        <Table head={['Handle', 'Name', 'Email', 'KYC tier', 'KYC status', 'Role', 'Joined']}>
          {items.map((u) => (
            <tr key={u.id} className="hover:bg-surface-low">
              <Td className="font-medium">{u.handle}</Td>
              <Td>{u.displayName ?? '—'}</Td>
              <Td className="max-w-[220px] truncate text-muted">{u.email ?? '—'}</Td>
              <Td>tier {u.kycTier}</Td>
              <Td>
                <Badge
                  tone={
                    u.kycStatus === 'approved' ? 'ok'
                    : u.kycStatus === 'declined' ? 'danger'
                    : u.kycStatus === 'none' ? 'muted'
                    : 'warn'
                  }
                >
                  {u.kycStatus}
                </Badge>
              </Td>
              <Td>
                {u.role === 'admin' ? <Badge tone="warn">admin</Badge> : <span className="text-muted">{u.role}</span>}
              </Td>
              <Td className="whitespace-nowrap text-muted">{at(u.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <LoadMore cursor={cursor} busy={busy} onMore={more} />
    </>
  );
}
