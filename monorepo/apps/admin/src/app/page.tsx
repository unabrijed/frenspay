'use client';

// Overview — the operator's pulse: order counts by state, everything needing a human (open
// disputes, stuck orders, risk flags, merchant alerts), and the cross-user order list. Raw state
// names on purpose. Polls every 8s, same as the old apps/web admin page this replaces.
import Link from 'next/link';
import { useCallback, useState } from 'react';

import type { AdminOrder } from '@fpay/shared';

import { api } from '@/services/api';
import {
  Badge,
  Denied,
  EmptyState,
  ErrorBanner,
  LoadMore,
  PageHead,
  SectionTitle,
  Spinner,
  stateClass,
  Table,
  Td,
  Who,
  relTime,
  usd,
  usePoll,
} from '@/components/ui';

const FILTERS = ['All', 'Live', 'Issues', 'Failed', 'Done'] as const;
type Filter = (typeof FILTERS)[number];

const isDone = (o: AdminOrder) => o.state === 'completed' || o.state === 'refunded';
const hasIssue = (o: AdminOrder) => o.resolution != null || o.state === 'failed';

const matches = (o: AdminOrder, f: Filter): boolean =>
  f === 'All' ? true
  : f === 'Live' ? !isDone(o) && o.state !== 'failed'
  : f === 'Issues' ? hasIssue(o)
  : f === 'Failed' ? o.state === 'failed'
  : isDone(o);

function OrderRows({ orders }: { orders: AdminOrder[] }) {
  return (
    <>
      {orders.map((o) => (
        <tr key={o.id} className="hover:bg-surface-low">
          <Td>
            <Link href={`/orders/${o.id}`} className="font-medium text-ink hover:text-accent">
              {o.userHandle} → {o.merchantName ?? '-'}
            </Link>
            <div className="max-w-[220px] truncate text-[11px] text-muted">{o.userEmail ?? '-'}</div>
          </Td>
          <Td className="whitespace-nowrap">{usd(o.amountUsdc)}</Td>
          <Td>
            <span className={stateClass(o.state, o.resolution)}>
              {o.state}
              {o.resolution ? ` · ${o.resolution}` : ''}
            </span>
          </Td>
          <Td className="whitespace-nowrap text-muted">{relTime(o.createdAt)}</Td>
        </tr>
      ))}
    </>
  );
}

export default function Overview() {
  // The one search (docs/22): @handle, email, reference or order id, exact, on Enter. It narrows the
  // orders list only; the attention tables above it stay the pulse. While a search is set the page
  // does not poll: the server audits every search, and an 8s poll would write a row a tick.
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const fetchBoth = useCallback(async () => {
    const [overview, orders] = await Promise.all([api.overview(), api.orders(undefined, q || undefined)]);
    return { overview, orders };
  }, [q]);
  const { data, err, denied } = usePoll(fetchBoth, q ? 0 : 8000);
  const [f, setF] = useState<Filter>('All');
  // Pages past the first are appended on demand and not re-polled — ops mostly lives on page 1.
  const [extra, setExtra] = useState<AdminOrder[]>([]);
  const [extraNext, setExtraNext] = useState<string | undefined>();
  const [moreBusy, setMoreBusy] = useState(false);

  if (denied) return <Denied />;
  if (!data) return (
    <>
      <PageHead title="Overview" />
      <ErrorBanner msg={err} />
      <Spinner />
    </>
  );

  const { overview, orders } = data;
  const cursor = extra.length === 0 ? orders.nextCursor : extraNext;
  const all = [...orders.orders, ...extra];
  const shown = all.filter((o) => matches(o, f));
  const issueCount =
    overview.openDisputes.length + overview.stuckOrders.length + overview.riskFlags.length + overview.merchantAlerts.length;

  return (
    <>
      <PageHead
        title="Overview"
        sub={issueCount === 0 ? 'All clear. Nothing needs a human.' : `${issueCount} item(s) need attention`}
      />
      <ErrorBanner msg={err} />

      {/* Order counts by state — the one-glance pulse. */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(overview.orderCounts).map(([state, n]) => (
          <span key={state} className={`rounded-full border border-hair bg-surface px-2.5 py-1 text-[12px] ${stateClass(state)}`}>
            {state} <span className="font-semibold">{n}</span>
          </span>
        ))}
        {overview.failedBridgeCount > 0 ? (
          <span className="rounded-full border border-hair bg-surface px-2.5 py-1 text-[12px] text-danger">
            bridge_failed <span className="font-semibold">{overview.failedBridgeCount}</span>
          </span>
        ) : null}
      </div>

      {overview.openDisputes.length > 0 ? (
        <>
          <SectionTitle>Open disputes</SectionTitle>
          <Table head={['Merchant', 'Amount', 'Opened', '']}>
            {overview.openDisputes.map((d) => (
              <tr key={d.id} className="hover:bg-surface-low">
                <Td className="font-medium">{d.merchantName}</Td>
                <Td className="whitespace-nowrap">{usd(d.amountUsdc)}</Td>
                <Td className="whitespace-nowrap text-muted">{relTime(d.createdAt)}</Td>
                <Td>
                  <Link href={`/orders/${d.orderId}`} className="font-semibold text-accent hover:text-accent-deep">
                    Review →
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}

      {overview.stuckOrders.length > 0 ? (
        <>
          <SectionTitle>Stuck orders</SectionTitle>
          <Table head={['User', 'Amount', 'State', 'Updated']}>
            {overview.stuckOrders.map((o) => (
              <tr key={o.id} className="hover:bg-surface-low">
                <Td>
                  <Link href={`/orders/${o.id}`} className="hover:text-accent">
                    <Who handle={o.userHandle} email={o.userEmail} />
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{usd(o.amountUsdc)}</Td>
                <Td>
                  <span className={stateClass(o.state, o.resolution)}>
                    {o.state} · {o.resolution}
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-muted">{relTime(o.updatedAt)}</Td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}

      {overview.riskFlags.length > 0 ? (
        <>
          <SectionTitle>Risk flags</SectionTitle>
          <Table head={['User', 'Kind', 'Amount', 'Reason', 'Decision', 'When']}>
            {overview.riskFlags.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Who handle={r.userHandle} email={r.userEmail} />
                </Td>
                <Td>{r.kind}</Td>
                <Td className="whitespace-nowrap">{r.amountUsdc != null ? usd(r.amountUsdc) : '-'}</Td>
                <Td className="max-w-[280px] truncate text-muted">{r.reason ?? '-'}</Td>
                <Td>
                  <Badge tone={r.decision === 'block' ? 'danger' : 'warn'}>{r.decision}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-muted">{relTime(r.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}

      {overview.merchantAlerts.length > 0 ? (
        <>
          <SectionTitle>Merchant alerts</SectionTitle>
          <Table head={['Merchant', 'Alert', '']}>
            {overview.merchantAlerts.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium">{m.name}</Td>
                <Td>
                  <Badge tone={m.status === 'suspended' ? 'danger' : 'warn'}>
                    {m.status === 'suspended' ? 'suspended' : `kyb ${m.kybStatus}`}
                  </Badge>
                </Td>
                <Td>
                  <Link href="/merchants" className="font-semibold text-accent hover:text-accent-deep">
                    Manage →
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}

      <SectionTitle>Orders</SectionTitle>
      <div className="mb-3 flex gap-1.5">
        {FILTERS.map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => setF(x)}
            className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
              f === x ? 'border-accent bg-accent text-white' : 'border-hair bg-surface text-ink hover:bg-surface-low'
            }`}
          >
            {x}
          </button>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            setExtra([]);
            setExtraNext(undefined);
            setQ(draft.trim());
          }}
          placeholder="@handle, email, reference or id, then Enter"
          aria-label="Search orders"
          className="ml-auto w-72 max-w-full rounded-full border border-hair bg-surface px-3 py-1 text-[12px] outline-none focus:border-accent"
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState text={q ? 'No orders match.' : 'No orders here.'} />
      ) : (
        <Table head={['Order', 'Amount', 'State', 'Created']}>
          <OrderRows orders={shown} />
        </Table>
      )}
      <LoadMore
        cursor={cursor}
        busy={moreBusy}
        onMore={() => {
          if (!cursor) return;
          setMoreBusy(true);
          void api
            .orders(cursor, q || undefined)
            .then((page) => {
              setExtra((prev) => [...prev, ...page.orders]);
              setExtraNext(page.nextCursor);
            })
            .finally(() => setMoreBusy(false));
        }}
      />
    </>
  );
}
