'use client';

// Merchants — every LP (real + sim) with the reputation signals routing ranks on, plus the
// admin actions: KYB approve/reject (pending only) and suspend/reinstate. Every action confirms
// first and lands in the audit trail server-side.
import { useCallback, useState } from 'react';

import type { AdminMerchant } from '@fpay/shared';

import { api } from '@/services/api';
import {
  Badge,
  Btn,
  Confirm,
  ConfirmDialog,
  Denied,
  EmptyState,
  ErrorBanner,
  PageHead,
  Spinner,
  Table,
  Td,
  usd,
  usePoll,
} from '@/components/ui';

const pct = (f: number) => `${(f * 100).toFixed(1)}%`;

export default function Merchants() {
  const fetchMerchants = useCallback(() => api.merchants(), []);
  const { data, err, denied, reload } = usePoll(fetchMerchants, 15000);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  if (denied) return <Denied />;

  const act = (m: AdminMerchant): Confirm[] => {
    const list: Confirm[] = [];
    if (m.kybStatus === 'pending') {
      list.push(
        {
          title: `Approve KYB — ${m.name}`,
          body: 'The merchant goes online and becomes routable for real orders.',
          confirmLabel: 'Approve',
          onConfirm: async () => {
            await api.merchantKyb(m.id, 'approve');
            await reload();
          },
        },
        {
          title: `Reject KYB — ${m.name}`,
          body: 'The application is rejected; the merchant stays offline.',
          confirmLabel: 'Reject',
          danger: true,
          onConfirm: async () => {
            await api.merchantKyb(m.id, 'reject');
            await reload();
          },
        },
      );
    }
    if (m.status !== 'suspended') {
      list.push({
        title: `Suspend — ${m.name}`,
        body: 'The merchant is pulled out of routing immediately. In-flight orders continue.',
        confirmLabel: 'Suspend',
        danger: true,
        onConfirm: async () => {
          await api.merchantStatus(m.id, 'suspended');
          await reload();
        },
      });
    } else {
      list.push({
        title: `Reinstate — ${m.name}`,
        body: 'The merchant goes back online and becomes routable again.',
        confirmLabel: 'Reinstate',
        onConfirm: async () => {
          await api.merchantStatus(m.id, 'online');
          await reload();
        },
      });
    }
    return list;
  };

  return (
    <>
      <PageHead title="Merchants" sub="LPs settling the fiat leg — reputation signals + lifecycle actions" />
      <ErrorBanner msg={err} />
      {!data ? (
        <Spinner />
      ) : data.merchants.length === 0 ? (
        <EmptyState text="No merchants yet." />
      ) : (
        <Table head={['Merchant', 'Rail', 'Status', 'KYB', 'Bond', 'Float', 'Success', 'Disputes', '👍', 'Actions']}>
          {data.merchants.map((m) => (
            <tr key={m.id} className="hover:bg-surface-low">
              <Td>
                <span className="font-medium">{m.name}</span>
                {!m.real ? <span className="ml-1.5 text-[11px] text-muted">sim</span> : null}
              </Td>
              <Td>{m.payoutRail}</Td>
              <Td>
                <Badge tone={m.status === 'online' ? 'ok' : m.status === 'suspended' ? 'danger' : 'muted'}>
                  {m.status}
                </Badge>
              </Td>
              <Td>
                <Badge tone={m.kybStatus === 'approved' ? 'ok' : m.kybStatus === 'pending' ? 'warn' : 'danger'}>
                  {m.kybStatus}
                </Badge>
              </Td>
              <Td className="whitespace-nowrap">{usd(m.bondUsdc)}</Td>
              <Td className="whitespace-nowrap">{usd(m.floatUsdc)}</Td>
              <Td>{pct(m.successRate)}</Td>
              <Td>{pct(m.disputeRate)}</Td>
              <Td>{pct(m.positiveRate)}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {act(m).map((c) => (
                    <Btn
                      key={c.title}
                      variant={c.danger ? 'danger' : c.confirmLabel === 'Approve' ? 'primary' : 'ghost'}
                      onClick={() => setConfirm(c)}
                    >
                      {c.confirmLabel}
                    </Btn>
                  ))}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
