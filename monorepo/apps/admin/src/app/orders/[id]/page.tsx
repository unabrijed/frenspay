'use client';

// /orders/[id] — the full flow record for one order: raw event timeline, routing attempts,
// dispute (with resolve actions when open), and escrow transfer legs. Deliberately NOT the
// consumer 7-step tracker — the operator wants what actually happened, timestamps and all.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';

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

  const resolveConfirm = (resolution: 'upheld' | 'rejected'): Confirm =>
    resolution === 'upheld'
      ? {
          title: 'Uphold dispute (refund payer)',
          body: `The payer gets ${usd(o.amountUsdc)} back from escrow and the merchant's bond is fined. This cannot be undone.`,
          confirmLabel: 'Uphold · refund payer',
          danger: true,
          onConfirm: async () => {
            await api.resolveDispute(d!.id, 'upheld');
            await reload();
          },
        }
      : {
          title: 'Reject dispute (release to merchant)',
          body: `The merchant is cleared; the ${usd(o.amountUsdc)} escrow releases to them on the next tick. This cannot be undone.`,
          confirmLabel: 'Reject · release funds',
          onConfirm: async () => {
            await api.resolveDispute(d!.id, 'rejected');
            await reload();
          },
        };

  return (
    <>
      <div className="mb-1 text-[12px]">
        <Link href="/" className="font-semibold text-muted hover:text-accent">
          ← Overview
        </Link>
      </div>
      <PageHead
        title={usd(o.amountUsdc)}
        sub={`${o.userHandle}${o.userEmail ? ` · ${o.userEmail}` : ''} → ${o.merchantName ?? '-'} · ${o.referenceCode}`}
      />
      <p className={`-mt-3 mb-4 text-[13px] font-medium ${stateClass(o.state, o.resolution)}`}>
        {o.state}
        {o.resolution ? ` · ${o.resolution}` : ''}
        {o.feedbackUp != null ? (o.feedbackUp ? ' · 👍' : ' · 👎') : ''}
      </p>
      <ErrorBanner msg={detail && err ? err : null} />

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
                  {d.resolvedAt ? ` · resolved ${at(d.resolvedAt)}` : ''}
                </p>
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
          <Table head={['Kind', 'Signature', 'Status']}>
            {detail.transfers.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.kind}</Td>
                <Td className="max-w-[420px] truncate text-muted">{t.signature ?? '-'}</Td>
                <Td>
                  <Badge tone={t.status === 'failed' ? 'danger' : t.status === 'confirmed' ? 'ok' : 'muted'}>
                    {t.status}
                  </Badge>
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
