'use client';

// Merchants — every LP (real + sim) with the reputation signals routing ranks on, plus the
// admin actions: KYB approve/reject (pending only) and suspend/reinstate. Every action confirms
// first and lands in the audit trail server-side.
import { Fragment, useCallback, useState } from 'react';

import type { AdminMerchant } from '@fpay/shared';
import { KYB_DECIDABLE, KYB_FIELDS } from '@fpay/shared';
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
    // A review can be decided once the merchant has actually submitted something. 'pending' means
    // they haven't yet, so there is nothing to judge — offering Approve there is how you approve a
    // business you have been told nothing about.
    if (KYB_DECIDABLE.includes(m.kybStatus)) {
      // Reasons are typed at the moment of deciding rather than picked from a list: the useful ones
      // are specific ("the PAN doesn't match the registered name"), and a dropdown of generic ones
      // is how "rejected: other" happens.
      const ask = (what: string) => window.prompt(`${what} — this is shown to the merchant:`)?.trim();
      list.push(
        {
          title: `Approve KYB: ${m.name}`,
          body: 'The business is verified. They can go online themselves whenever they like — approval does NOT put them into routing.',
          confirmLabel: 'Approve',
          onConfirm: async () => {
            await api.merchantKyb(m.id, 'approve');
            await reload();
          },
        },
        {
          title: `Ask for more: ${m.name}`,
          body: 'The merchant can edit and resubmit. Use this instead of rejecting when something is merely missing or mistyped.',
          confirmLabel: 'Ask',
          onConfirm: async () => {
            const note = ask('What do you need from them?');
            if (!note) return;
            await api.merchantKyb(m.id, 'more_info', note);
            await reload();
          },
        },
        {
          title: `Reject KYB: ${m.name}`,
          body: 'Terminal. The merchant cannot resubmit — prefer "Ask for more" unless the business itself is the problem.',
          confirmLabel: 'Reject',
          danger: true,
          onConfirm: async () => {
            const note = ask('Why is this rejected?');
            if (!note) return;
            await api.merchantKyb(m.id, 'reject', note);
            await reload();
          },
        },
      );
      if (m.kybStatus === 'submitted') {
        list.push({
          title: `Claim for review: ${m.name}`,
          body: 'Marks it as being looked at, so a second reviewer knows someone is already on it.',
          confirmLabel: 'Claim',
          onConfirm: async () => {
            const note = ask('Anything to tell them while they wait?') || 'A reviewer is looking at this now.';
            await api.merchantKyb(m.id, 'review', note);
            await reload();
          },
        });
      }
    }
    if (m.status !== 'suspended') {
      list.push({
        title: `Suspend: ${m.name}`,
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
        title: `Reinstate: ${m.name}`,
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
      <PageHead title="Merchants" sub="LPs settling the fiat leg: reputation signals and lifecycle actions" />
      <ErrorBanner msg={err} />
      {!data ? (
        <Spinner />
      ) : data.merchants.length === 0 ? (
        <EmptyState text="No merchants yet." />
      ) : (
        <Table head={['Merchant', 'Rail', 'Status', 'KYB', 'Bond', 'Float', 'Success', 'Disputes', '👍', 'Actions']}>
          {data.merchants.map((m) => (
            <Fragment key={m.id}>
            <tr className="hover:bg-surface-low">
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
                <Badge tone={m.kybStatus === 'approved' ? 'ok' : m.kybStatus === 'rejected' ? 'danger' : 'warn'}>
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
            {/* The submission itself, shown exactly while a decision is open — approving a business
                nobody can read is the bug this row exists to prevent. Labels come from the same
                shared spec the form rendered, so reviewer and applicant read identical words. */}
            {m.kybFields && KYB_DECIDABLE.includes(m.kybStatus) ? (
              <tr className="bg-surface-low/40">
                <td colSpan={10} className="px-3 pb-2 pt-0">
                  <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-[12px] text-muted">
                    {(KYB_FIELDS[m.country] ?? [])
                      .filter((f) => m.kybFields?.[f.key])
                      .map((f) => (
                        <span key={f.key}>
                          {f.label}: <span className="text-ink">{m.kybFields![f.key]}</span>
                        </span>
                      ))}
                  </div>
                </td>
              </tr>
            ) : null}
            </Fragment>
          ))}
        </Table>
      )}
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
