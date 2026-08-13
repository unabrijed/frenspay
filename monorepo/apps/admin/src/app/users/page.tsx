'use client';

// Users — the account directory (handle, KYC tier/status, role, lifecycle) and the admin TEAM
// surface. Keyset-paginated.
//
// Promoting an operator used to be SQL-only: the complete set of writes to users.role in the repo
// was the merchant-apply mirror, a dev seed hardcoded to @bridge, and a test fixture.
//
// The server refuses the lockout demotions (yourself, ADMIN_EMAILS) and the lockout suspensions
// (self, any admin), plus the denylist-rename hazard. This page doesn't try to predict any of them:
// it offers the action and shows the server's refusal, so each rule lives in exactly one place.
import { useCallback, useState } from 'react';

import type { AdminUser } from '@fpay/shared';

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
  LoadMore,
  PageHead,
  Spinner,
  Table,
  Td,
  usePaged,
} from '@/components/ui';

/** Edit (rename + display name), suspend/reinstate, or delete — the actions that need typed input,
 *  which ConfirmDialog deliberately doesn't do. Same overlay skin, denylist-form inputs. */
type UserAction = { user: AdminUser; mode: 'edit' | 'status' | 'delete' };

const FIELD =
  'h-8 rounded-md border border-outline bg-surface px-2 text-[13px] font-normal normal-case tracking-normal text-ink placeholder:text-muted/50';
const LABEL = 'flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted';

function UserActionDialog({ action, onClose, onDone }: { action: UserAction | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  if (!action) return null;
  const { user, mode } = action;
  // Reset per target without an effect: remount state when the dialog's subject changes.
  const thisKey = `${user.id}:${mode}`;
  if (key !== thisKey) {
    setKey(thisKey);
    setHandle('');
    setName('');
    setReason('');
    setBusy(false);
    setErr(null);
    return null; // re-renders immediately with clean state
  }

  const suspending = mode === 'status' && user.status === 'active';
  const canSubmit = mode === 'edit' ? Boolean(handle.trim() || name.trim()) : Boolean(reason.trim());

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'edit') {
        await api.userPatch(user.id, {
          handle: handle.trim() || undefined,
          displayName: name.trim() || undefined,
          reason: reason.trim() || undefined,
        });
      } else {
        await api.userStatus(user.id, {
          status: mode === 'delete' ? 'deleted' : suspending ? 'suspended' : 'active',
          reason: reason.trim(),
        });
      }
      await onDone();
      onClose();
    } catch (e) {
      setErr(errMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-hair bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-[15px] font-bold">
          {mode === 'edit'
            ? `Edit ${user.handle}`
            : mode === 'delete'
              ? `Delete ${user.handle}`
              : suspending
                ? `Suspend ${user.handle}`
                : `Reinstate ${user.handle}`}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          {mode === 'edit'
            ? `Renaming frees ${user.handle} immediately — anyone can claim it, and their old QR codes follow the claimant. Their payment history stays theirs.`
            : mode === 'delete'
              ? `They lose app access immediately and ${user.handle} is released — anyone can claim it. Their transaction history and any balance are untouched; the money stays theirs in their own embedded wallet. There is no undelete button.`
              : suspending
                ? 'They are signed out of the app in effect: every request is refused and their handle stops resolving, so nobody can send to them. Their money is untouched. Their merchant account, if any, is suspended too.'
                : 'They get the app back immediately. A suspended merchant account stays suspended — reinstate it from the Merchants page if that was intended.'}
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {mode === 'edit' ? (
            <>
              <label className={LABEL}>
                New handle
                <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={`${user.handle} (blank = keep)`} className={FIELD} />
              </label>
              <label className={LABEL}>
                Display name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={user.displayName ?? '(blank = keep)'} className={FIELD} />
              </label>
            </>
          ) : null}
          <label className={LABEL}>
            Reason{mode === 'edit' ? ' (optional)' : ''}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="for the audit trail" className={FIELD} />
          </label>
        </div>
        {err ? <p className="mt-2 text-[12px] text-danger">{err}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn
            variant={mode === 'edit' || mode === 'delete' || suspending ? 'danger' : 'primary'}
            disabled={busy || !canSubmit}
            onClick={submit}
          >
            {busy
              ? 'Working…'
              : mode === 'edit'
                ? 'Save changes'
                : mode === 'delete'
                  ? 'Delete account'
                  : suspending
                    ? 'Suspend'
                    : 'Reinstate'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export default function Users() {
  const fetchPage = useCallback(
    (cursor?: string) => api.users(cursor).then((r) => ({ items: r.users, nextCursor: r.nextCursor })),
    [],
  );
  const { items, cursor, busy, loaded, err, denied, more, reload } = usePaged(fetchPage);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [action, setAction] = useState<UserAction | null>(null);

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
        <Table head={['Handle', 'Name', 'Email', 'KYC tier', 'KYC status', 'Role', 'Status', 'Joined', '']}>
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
              <Td>
                {u.status === 'suspended' ? (
                  <Badge tone="danger">suspended</Badge>
                ) : u.status === 'deleted' ? (
                  <Badge tone="danger">deleted</Badge>
                ) : (
                  <span className="text-muted">active</span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-muted">{at(u.createdAt)}</Td>
              <Td>
                {/* A deleted row offers nothing: reinstate would leave a scrambled handle (a real
                    undelete needs a rename anyway — manual SQL is the rare-recovery escape hatch). */}
                {u.status === 'deleted' ? (
                  <span className="text-muted">—</span>
                ) : (
                <div className="flex gap-1">
                  <Btn variant="ghost" onClick={() => setAction({ user: u, mode: 'edit' })}>
                    Edit
                  </Btn>
                  <Btn
                    variant={u.status === 'active' ? 'danger' : 'ghost'}
                    onClick={() => setAction({ user: u, mode: 'status' })}
                  >
                    {u.status === 'active' ? 'Suspend' : 'Reinstate'}
                  </Btn>
                  <Btn variant="ghost" onClick={() => setAction({ user: u, mode: 'delete' })}>
                    Delete
                  </Btn>
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
                </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <LoadMore cursor={cursor} busy={busy} onMore={more} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
      <UserActionDialog action={action} onClose={() => setAction(null)} onDone={reload} />
    </>
  );
}
