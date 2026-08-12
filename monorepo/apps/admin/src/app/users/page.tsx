'use client';

// Users — the account directory (handle, KYC tier/status, role) and the admin TEAM surface.
// Keyset-paginated.
//
// Promoting an operator used to be SQL-only: the complete set of writes to users.role in the repo
// was the merchant-apply mirror, a dev seed hardcoded to @bridge, and a test fixture.
//
// The server refuses two demotions — yourself, and anyone named in ADMIN_EMAILS — because both end
// with a console nobody can get into. This page doesn't try to predict either: it offers the action
// and shows the server's refusal, so the rule lives in exactly one place.
import { useCallback, useState } from 'react';

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
  const { items, cursor, busy, loaded, err, denied, more, reload } = usePaged(fetchPage);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  if (denied) return <Denied />;
  return (
    <>
      <PageHead title="Users" sub="Every account: KYC tier gates money movement, role gates this console" />
      <ErrorBanner msg={err} />
      {!loaded ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState text="No users yet." />
      ) : (
        <Table head={['Handle', 'Name', 'Email', 'KYC tier', 'KYC status', 'Role', 'Joined', '']}>
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
              <Td>
                <Btn
                  variant={u.role === 'admin' ? 'danger' : 'ghost'}
                  onClick={() =>
                    setConfirm(
                      u.role === 'admin'
                        ? {
                            title: `Remove admin from ${u.handle}`,
                            body: 'They lose the console immediately. Their account and any merchant role are untouched.',
                            confirmLabel: 'Remove admin',
                            danger: true,
                            onConfirm: async () => {
                              await api.userRole(u.id, { role: 'user' });
                              await reload();
                            },
                          }
                        : {
                            title: `Make ${u.handle} an admin`,
                            body: 'They get this console: every order, every user, the denylist, and the ability to mint invites and change roles.',
                            confirmLabel: 'Make admin',
                            onConfirm: async () => {
                              await api.userRole(u.id, { role: 'admin' });
                              await reload();
                            },
                          },
                    )
                  }
                >
                  {u.role === 'admin' ? 'Remove admin' : 'Make admin'}
                </Btn>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <LoadMore cursor={cursor} busy={busy} onMore={more} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
