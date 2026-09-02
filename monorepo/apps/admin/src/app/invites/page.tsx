'use client';

// Invites — every code, who owns it, and who burned it. This console is the ONLY place a code is
// readable after its owner's one look at signup, which is why the strings are stored in plain text
// rather than hashed.
//
// Minting here is also the answer to "we've run out of invites": leave the owner blank and you get
// HOUSE codes, which belong to nobody and so are constrained by nobody's allowance.
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
  LoadMore,
  PageHead,
  Spinner,
  Table,
  Td,
  usePaged,
} from '@/components/ui';

export default function Invites() {
  const fetchPage = useCallback(
    (cursor?: string) => api.invites(cursor).then((r) => ({ items: r.invites, nextCursor: r.nextCursor })),
    [],
  );
  const { items, cursor, busy, loaded, err, denied, more, reload } = usePaged(fetchPage);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [count, setCount] = useState('3');
  const [owner, setOwner] = useState('');
  const [note, setNote] = useState('');
  const [minting, setMinting] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  // Held until the next mint or a reload: once this block is gone the codes are still in the table
  // below, but this is the copy-out moment.
  const [minted, setMinted] = useState<string[]>([]);

  if (denied) return <Denied />;

  const mint = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(count);
    if (minting || !Number.isInteger(n) || n < 1) return;
    setMinting(true);
    setFormErr(null);
    try {
      const res = await api.inviteMint({
        count: n,
        ownerHandle: owner.trim() || undefined,
        note: note.trim() || undefined,
      });
      setMinted(res.codes);
      setNote('');
      await reload();
    } catch (e2) {
      setFormErr(errMessage(e2));
    } finally {
      setMinting(false);
    }
  };

  return (
    <>
      <PageHead title="Invites" sub="Every code, its owner, and who signed up on it. The only place these are readable" />
      <ErrorBanner msg={err} />

      <form onSubmit={mint} className="mb-5 flex flex-wrap items-end gap-2 rounded-lg border border-hair bg-surface p-3">
        <label className="flex w-[90px] flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Count
          <input
            value={count}
            onChange={(e) => setCount(e.target.value)}
            inputMode="numeric"
            className="h-8 rounded-md border border-outline bg-surface px-2 text-[13px] font-normal normal-case tracking-normal text-ink"
          />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Owner
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="@handle, blank for house codes"
            className="h-8 rounded-md border border-outline bg-surface px-2 text-[13px] font-normal normal-case tracking-normal text-ink placeholder:text-muted/50"
          />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="what these are for (optional)"
            className="h-8 rounded-md border border-outline bg-surface px-2 text-[13px] font-normal normal-case tracking-normal text-ink placeholder:text-muted/50"
          />
        </label>
        <Btn type="submit" variant="primary" disabled={minting}>
          {minting ? 'Minting…' : 'Mint'}
        </Btn>
        {formErr ? <p className="w-full text-[12px] text-danger">{formErr}</p> : null}
      </form>

      {minted.length > 0 ? (
        <div className="mb-5 rounded-lg border border-hair bg-surface-low p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Just minted. Copy these out
          </p>
          <div className="flex flex-wrap gap-2">
            {minted.map((c) => (
              <code key={c} className="rounded-md border border-outline bg-surface px-2 py-1 text-[13px] text-ink">
                {c}
              </code>
            ))}
          </div>
        </div>
      ) : null}

      {!loaded ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState text="No invite codes yet." />
      ) : (
        <Table head={['Code', 'Owner', 'Status', 'Redeemed by', 'Note', 'Created', '']}>
          {items.map((i) => (
            <tr key={i.code} className="hover:bg-surface-low">
              <Td className="font-medium">{i.code}</Td>
              <Td>{i.ownerHandle ?? <Badge tone="muted">house</Badge>}</Td>
              <Td>
                <Badge tone={i.status === 'unused' ? 'ok' : i.status === 'burned' ? 'muted' : 'danger'}>
                  {i.status}
                </Badge>
              </Td>
              <Td className="text-muted">{i.redeemedByHandle ?? '-'}</Td>
              <Td className="max-w-[240px] truncate text-muted">{i.note ?? '-'}</Td>
              <Td className="whitespace-nowrap text-muted">{at(i.createdAt)}</Td>
              <Td>
                {/* Only unused codes can be revoked. A burned one created an account that still
                    exists, so un-inviting it would make the audit trail lie. */}
                {i.status === 'unused' ? (
                  <Btn
                    variant="danger"
                    onClick={() =>
                      setConfirm({
                        title: `Revoke ${i.code}`,
                        body: i.ownerHandle
                          ? `${i.ownerHandle} loses this invite. Nobody can sign up on it again.`
                          : 'This house code stops working immediately.',
                        confirmLabel: 'Revoke',
                        danger: true,
                        onConfirm: async () => {
                          await api.inviteRevoke(i.code);
                          await reload();
                        },
                      })
                    }
                  >
                    Revoke
                  </Btn>
                ) : null}
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
