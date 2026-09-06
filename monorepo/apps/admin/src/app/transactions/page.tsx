'use client';

// Transactions — the money ledger across every user: sends, top-ups, escrow legs, stake credits,
// bridge legs (docs/22). Orders are not all transactions: a plain send appears nowhere else in this
// console. One exact search (@handle, email, an id, a signature, a reference); a search by handle
// IS a person's statement, and the server audits the shape of every search. Keyset-paginated,
// absolute times: this page is evidence, not a pulse.
import Link from 'next/link';
import { useCallback, useState } from 'react';

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
  usd,
  usePaged,
} from '@/components/ui';

const shortAddr = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;

/** One side of a transfer: the handle when it is an fpay account, the address under it (or alone). */
function Side({ handle, address }: { handle: string | null; address: string | null }) {
  return (
    <div>
      <div className="font-medium">{handle ?? (address ? shortAddr(address) : '-')}</div>
      {handle && address ? <div className="font-mono text-[11px] text-muted">{shortAddr(address)}</div> : null}
    </div>
  );
}

export default function Transactions() {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  // A new `q` is a new fetcher, and usePaged re-fetches from the start on that: the list resets.
  const fetchPage = useCallback(
    (cursor?: string) =>
      api.transfers(cursor, q || undefined).then((r) => ({ items: r.transfers, nextCursor: r.nextCursor })),
    [q],
  );
  const { items, cursor, busy, loaded, err, denied, more } = usePaged(fetchPage);

  if (denied) return <Denied />;
  return (
    <>
      <PageHead title="Transactions" sub="Every transfer, every user: sends, top-ups, escrow legs, stake, bridge" />
      <ErrorBanner msg={err} />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setQ(draft.trim());
        }}
        placeholder="@handle, email, id, signature or reference, then Enter"
        aria-label="Search transactions"
        className="mb-3 w-96 max-w-full rounded-full border border-hair bg-surface px-3 py-1.5 text-[12px] outline-none focus:border-accent"
      />
      {!loaded ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState text={q ? 'Nothing matches.' : 'No transfers yet.'} />
      ) : (
        <Table head={['From → To', 'Kind', 'Amount', 'Status', 'Order', 'Signature', 'When']}>
          {items.map((t) => (
            <tr key={t.id} className="hover:bg-surface-low">
              <Td>
                <div className="flex items-center gap-2">
                  <Side handle={t.fromHandle} address={t.fromAddress} />
                  <span className="text-muted">→</span>
                  <Side handle={t.toHandle} address={t.toAddress} />
                </div>
              </Td>
              <Td>
                <div className="font-medium">{t.kind}</div>
                {t.note ? <div className="max-w-[200px] truncate text-[11px] text-muted">{t.note}</div> : null}
              </Td>
              <Td className="whitespace-nowrap">{usd(t.amountUsdc)}</Td>
              <Td>
                <Badge tone={t.status === 'failed' ? 'danger' : t.status === 'confirmed' ? 'ok' : 'muted'}>{t.status}</Badge>
                {t.bridgeState ? (
                  <div className="mt-1 text-[11px] text-muted">
                    {t.bridgeChain ?? t.chain} · {t.bridgeState}
                  </div>
                ) : null}
              </Td>
              <Td>
                {t.orderId ? (
                  <Link href={`/orders/${t.orderId}`} className="font-mono text-[12px] text-accent hover:text-accent-deep">
                    {t.orderReference}
                  </Link>
                ) : (
                  <span className="text-muted">-</span>
                )}
              </Td>
              <Td>
                {t.signature ? (
                  <a
                    href={`https://solscan.io/tx/${t.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[12px] text-accent hover:text-accent-deep"
                  >
                    {shortAddr(t.signature)}
                  </a>
                ) : (
                  <span className="text-muted">-</span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-muted">{at(t.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <LoadMore cursor={cursor} busy={busy} onMore={more} />
    </>
  );
}
