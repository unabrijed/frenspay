'use client';

// /orders/[id] — the full record for one order, in the order a dispute call needs it: the payee,
// the UTR and the window first, then the money the quote was struck on, the parts of a split, the
// raw event timeline, routing attempts, the dispute (with resolve actions when open, and who
// decided what once closed), and every transfer that ever touched the payment. Deliberately NOT
// the consumer 7-step tracker — the operator wants what actually happened, timestamps and all.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import { vpaOperator } from '@fpay/shared';

import { api, ApiError } from '@/services/api';
import {
  at,
  Badge,
  Btn,
  Confirm,
  ConfirmDialog,
  Denied,
  ErrorBanner,
  PageHead,
  SectionTitle,
  Spinner,
  stateClass,
  Table,
  Td,
  usd,
  usePoll,
} from '@/components/ui';

const shortAddr = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const fetchDetail = useCallback(() => api.order(id), [id]);
  const { data: detail, err, denied, reload } = usePoll(fetchDetail);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  if (denied) return <Denied />;
  if (err && !detail) {
    const notFound = err === 'order not found';
    return (
      <>
        <PageHead title="Order" />
        <ErrorBanner msg={notFound ? 'Order not found.' : err} />
        <Link href="/" className="text-[13px] font-semibold text-accent">
          ← Back to overview
        </Link>
      </>
    );
  }
  if (!detail) return <Spinner />;

  const o = detail.order;
  const d = detail.dispute;
  const q = o.quote;
  const operator = q.payoutDestination ? vpaOperator(q.payoutDestination)?.name : undefined;
  // A null deadline on an order under review is the dispute holding the escrow, not a lapsed clock.
  const windowEnds = o.expiresAt ? at(o.expiresAt) : o.resolution === 'under_review' ? 'frozen by dispute' : '-';
  // The call order: what the payer and the partner are each looking at, then what the quote was
  // struck on. Nobody reads a spread to answer "the shop did not get it".
  const record: Array<[string, ReactNode]> = [
    ['Amount', `${o.amountFiat ?? q.amountInr} ${q.currency}`],
    ['USDC', usd(o.amountUsdc)],
    ['Payee', q.payoutName ?? '-'],
    [
      'Paid to',
      q.payoutDestination ? `${q.payoutDestination} · ${q.payoutMethod}${operator ? ` · ${operator}` : ''}` : '-',
    ],
    ['UTR', o.payoutUtr ?? '-'],
    ['Claimed at', o.payoutClaimedAt ? at(o.payoutClaimedAt) : '-'],
    ['Window ends', windowEnds],
    ['Locked', o.lockedAt ? `${at(o.lockedAt)}${o.lockExpiresAt ? ` · until ${at(o.lockExpiresAt)}` : ''}` : '-'],
    ['Partner', o.merchantName],
    ['Reference', o.referenceCode],
    ['Created', at(o.createdAt)],
    ['Updated', at(o.updatedAt)],
    ['All-in rate', `${q.rate} ${q.currency} per USDC`],
    // A set mid with no fetch time priced off the configured fallback; none at all predates 0029.
    ['Mid at strike', o.midRate ? `${o.midRate} · ${o.midRateAsOf ? at(o.midRateAsOf) : 'fallback rate'}` : '-'],
    ['Spread', `${o.spreadBps} bps`],
    ['Platform fee', usd(o.platformFeeUsdc)],
  ];

  // The reason is typed at the moment of deciding, the way a KYB decision's is (merchants/page.tsx):
  // the server refuses a resolution without one, because sixty days on "upheld" with nothing behind
  // it is not a record. Cancelling the prompt, or leaving it blank, decides nothing.
  const ask = () => window.prompt('Why? This is the record of the decision. Never shown to the partner or the payer:')?.trim();
  const resolveConfirm = (resolution: 'upheld' | 'rejected'): Confirm =>
    resolution === 'upheld'
      ? {
          title: 'Uphold dispute (refund payer)',
          body: `The payer gets ${usd(o.amountUsdc)} back from escrow and the merchant's bond is fined. This cannot be undone.`,
          confirmLabel: 'Uphold · refund payer',
          danger: true,
          onConfirm: async () => {
            const note = ask();
            if (!note) return;
            await api.resolveDispute(d!.id, 'upheld', note);
            await reload();
          },
        }
      : {
          title: 'Reject dispute (release to merchant)',
          body: `The merchant is cleared; the ${usd(o.amountUsdc)} escrow releases to them on the next tick. This cannot be undone.`,
          confirmLabel: 'Reject · release funds',
          onConfirm: async () => {
            const note = ask();
            if (!note) return;
            await api.resolveDispute(d!.id, 'rejected', note);
            await reload();
          },
        };

  const tone = (status: 'pending' | 'confirmed' | 'failed') =>
    status === 'failed' ? 'danger' : status === 'confirmed' ? 'ok' : 'muted';

  return (
    <>
      <div className="mb-1 text-[12px]">
        <Link href="/" className="font-semibold text-muted hover:text-accent">
          ← Overview
        </Link>
      </div>
      <PageHead
        title={usd(o.amountUsdc)}
        sub={`${o.userHandle}${o.userEmail ? ` · ${o.userEmail}` : ''} → ${o.merchantName} · ${o.referenceCode}`}
      />
      <p className={`-mt-3 mb-4 text-[13px] font-medium ${stateClass(o.state, o.resolution)}`}>
        {o.state}
        {o.resolution ? ` · ${o.resolution}` : ''}
        {o.feedbackUp != null ? (o.feedbackUp ? ' · 👍' : ' · 👎') : ''}
      </p>
      <ErrorBanner msg={detail && err ? err : null} />

      <SectionTitle>Record</SectionTitle>
      <Table head={['Field', 'Value']}>
        {record.map(([k, v]) => (
          <tr key={k}>
            <Td className="whitespace-nowrap text-muted">{k}</Td>
            <Td className="font-medium">{v}</Td>
          </tr>
        ))}
      </Table>

      {detail.legs.length > 1 ? (
        <>
          <SectionTitle>Parts</SectionTitle>
          <Table head={['Reference', 'Partner', 'State', 'USDC', 'Amount', 'UTR']}>
            {detail.legs.map((l) => (
              <tr key={l.id} className={l.id === o.id ? 'bg-surface-low' : 'hover:bg-surface-low'}>
                <Td>
                  <Link href={`/orders/${l.id}`} className="font-mono text-[12px] text-accent">
                    {l.referenceCode}
                  </Link>
                </Td>
                <Td>{l.merchantName}</Td>
                <Td>
                  <span className={stateClass(l.state, l.resolution)}>{l.state}</span>
                </Td>
                <Td className="whitespace-nowrap">{usd(l.amountUsdc)}</Td>
                <Td className="whitespace-nowrap">
                  {l.amountFiat ?? l.quote.amountInr} {q.currency}
                </Td>
                <Td className="font-mono text-[12px]">{l.payoutUtr ?? '-'}</Td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}

      <SectionTitle>Timeline</SectionTitle>
      <Table head={['Event', 'Transition', 'At']}>
        {(o.events ?? []).map((e, i) => (
          <tr key={i}>
            <Td className="font-medium">{e.event}</Td>
            <Td className="text-muted">
              {e.fromState ?? '-'} → {e.toState}
              {e.detail ? ` · ${JSON.stringify(e.detail)}` : ''}
            </Td>
            <Td className="whitespace-nowrap text-muted">{at(e.createdAt)}</Td>
          </tr>
        ))}
      </Table>

      {detail.routingAttempts.length > 0 ? (
        <>
          <SectionTitle>Routing</SectionTitle>
          <Table head={['#', 'Merchant', 'Reason', 'Outcome']}>
            {detail.routingAttempts.map((a) => (
              <tr key={a.sequence}>
                <Td className="text-muted">{a.sequence}</Td>
                <Td className="font-medium">{a.merchantName}</Td>
                <Td className="max-w-[320px] truncate text-muted">{a.reason ?? '-'}</Td>
                <Td>
                  <Badge tone={a.outcome === 'failed' ? 'danger' : a.outcome === 'released' ? 'ok' : 'muted'}>
                    {a.outcome}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}

      {d ? (
        <>
          <SectionTitle>Dispute</SectionTitle>
          <div className="rounded-lg border border-hair bg-surface p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{d.reason ?? 'No reason given'}</p>
                <p className="mt-1 text-[12px] text-muted">
                  Opened {at(d.createdAt)}
                  {d.resolvedAt ? ` · resolved ${at(d.resolvedAt)}${d.resolvedBy ? ` by ${d.resolvedBy}` : ''}` : ''}
                  {d.bondDrawnUsdc ? ` · bond drawn ${usd(d.bondDrawnUsdc)}` : ''}
                </p>
                {d.note ? <p className="mt-2 text-[13px]">{d.note}</p> : null}
              </div>
              <Badge tone={d.status === 'open' ? 'danger' : 'muted'}>{d.resolution ?? d.status}</Badge>
            </div>
            {d.status === 'open' ? (
              <div className="mt-4 flex gap-2 border-t border-hair pt-3">
                <Btn variant="danger" onClick={() => setConfirm(resolveConfirm('upheld'))}>
                  Uphold: refund payer
                </Btn>
                <Btn onClick={() => setConfirm(resolveConfirm('rejected'))}>Reject: release to merchant</Btn>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {detail.transfers.length > 0 ? (
        <>
          <SectionTitle>Transfers</SectionTitle>
          <Table head={['Kind', 'Amount', 'From → To', 'Order', 'Status', 'Created', 'Confirmed', 'Signature']}>
            {detail.transfers.map((t) => (
              <tr key={t.id}>
                <Td>
                  <div className="font-medium">{t.kind}</div>
                  {t.note ? <div className="text-[11px] text-muted">{t.note}</div> : null}
                </Td>
                <Td className="whitespace-nowrap">{usd(t.amountUsdc)}</Td>
                <Td className="whitespace-nowrap font-mono text-[11px] text-muted">
                  {t.fromAddress ? shortAddr(t.fromAddress) : '-'} → {t.toAddress ? shortAddr(t.toAddress) : '-'}
                </Td>
                <Td className="font-mono text-[12px]">{t.orderReference}</Td>
                <Td>
                  <Badge tone={tone(t.status)}>{t.status}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-muted">{at(t.createdAt)}</Td>
                <Td className="whitespace-nowrap text-muted">{t.confirmedAt ? at(t.confirmedAt) : '-'}</Td>
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
                    '-'
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}

      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
