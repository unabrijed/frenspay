'use client';

// Merchants — every LP (real + sim) with the reputation signals routing ranks on, plus the
// admin actions: KYB approve/reject (pending only) and suspend/reinstate. Every action confirms
// first and lands in the audit trail server-side.
import { Fragment, useCallback, useState } from 'react';

import type { AdminMerchant, AdminStakeWithdrawal } from '@fpay/shared';
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
  Who,
  usd,
  usePoll,
} from '@/components/ui';

const pct = (f: number) => `${(f * 100).toFixed(1)}%`;

export default function Merchants() {
  const fetchMerchants = useCallback(() => api.merchants(), []);
  const { data, err, denied, reload } = usePoll(fetchMerchants, 15000);
  const fetchWithdrawals = useCallback(() => api.stakeWithdrawals('requested'), []);
  const { data: withdrawals, reload: reloadWithdrawals } = usePoll(fetchWithdrawals, 15000);
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
          // This approves the BUSINESS and nothing else. It used to also grant the owner tier 2 while
          // the identity vendor was off; that was removed on 2026-08-29 (docs/14) because no partner
          // capability reads a tier — only payer ones do. The Identity column still shows where the
          // person stands, because admitting a partner the vendor never checked is worth seeing.
          body:
            m.ownerKycTier !== undefined && m.ownerKycTier < 2
              ? 'The business is verified. Note this person has NOT passed an identity check — approve on the strength of the details below, and only if they hold up. Their own payment limits are unchanged.'
              : 'The business is verified. They can go online themselves whenever they like — approval does NOT put them into routing.',
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
    } else if (m.suspendReason !== 'exited') {
      // Back to OFFLINE, never online: the LP flips themselves online through the switch that
      // enforces KYB + bond. An exited row is frozen for good and offers nothing.
      list.push({
        title: `Reinstate: ${m.name}`,
        body: 'The merchant goes back to offline. They go online themselves once KYB and the stake floor allow it.',
        confirmLabel: 'Reinstate',
        onConfirm: async () => {
          await api.merchantStatus(m.id, 'offline');
          await reload();
        },
      });
    }
    return list;
  };

  // A root admin sends the USDC from the cold stake treasury by hand, then records the signature
  // here. window.prompt on purpose: one rare, single-field entry by the one person who holds the key.
  const release = async (w: AdminStakeWithdrawal) => {
    const sig = window.prompt(
      `Signature of the ${usd(w.amountUsdc)} USDC you sent to ${w.payoutWallet ?? '(no wallet on file)'} for ${w.merchantName}:`,
    );
    if (!sig) return;
    await api.releaseStakeWithdrawal(w.id, sig.trim());
    await Promise.all([reload(), reloadWithdrawals()]);
  };

  return (
    <>
      <PageHead title="Merchants" sub="LPs settling the fiat leg: reputation signals and lifecycle actions" />
      <ErrorBanner msg={err} />
      {/* Stake on its way back. The bond is already debited; nothing here moves money — a root admin
          sends the USDC from the cold treasury by hand and records the signature (docs/15). */}
      {withdrawals && withdrawals.withdrawals.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium">Stake withdrawals waiting to be sent</h2>
          <Table head={['Merchant', 'Amount', 'Send to', 'Requested', '']}>
            {withdrawals.withdrawals.map((w) => (
              <tr key={w.id} className="hover:bg-surface-low">
                <Td>
                  <span className="font-medium">{w.merchantName}</span>
                  {w.exit ? <span className="ml-1.5 text-[11px] text-muted">leaving</span> : null}
                </Td>
                <Td className="whitespace-nowrap">{usd(w.amountUsdc)}</Td>
                <Td className="font-mono text-[12px]">{w.payoutWallet ?? <span className="text-muted">no wallet on file</span>}</Td>
                <Td className="whitespace-nowrap">{new Date(w.requestedAt).toLocaleString()}</Td>
                <Td>
                  <Btn variant="primary" onClick={() => void release(w)} disabled={!w.payoutWallet}>
                    Record as sent
                  </Btn>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}
      {!data ? (
        <Spinner />
      ) : data.merchants.length === 0 ? (
        <EmptyState text="No merchants yet." />
      ) : (
        <Table head={['Merchant', 'Account', 'Contact', 'Identity', 'Rail', 'Status', 'KYB', 'Bond', 'Float', 'Success', 'Disputes', '👍', 'Actions']}>
          {data.merchants.map((m) => (
            <Fragment key={m.id}>
            <tr className="hover:bg-surface-low">
              <Td>
                <span className="font-medium">{m.name}</span>
                {!m.real ? <span className="ml-1.5 text-[11px] text-muted">sim</span> : null}
              </Td>
              {/* The owner's fpay account — the same email they sign in with here and in the wallet app,
                  so a reviewer never has to go and find it on the Users page. Platform rows have none. */}
              <Td>{m.ownerHandle ? <Who handle={m.ownerHandle} email={m.ownerEmail} /> : <span className="text-muted">—</span>}</Td>
              {/* The reviewer's only way to reach a human about the application in front of them. */}
              <Td>{m.contactPhone ?? <span className="text-muted">—</span>}</Td>
              {/* Where the person stands, and who decided it. A partner sitting at tier 1 is normal
                  while the vendor is off — nothing a partner does reads a tier. It is shown so a
                  reviewer knows an identity check has not happened, not because it blocks anything. */}
              <Td className="whitespace-nowrap">
                {m.ownerKycTier === undefined ? (
                  <span className="text-muted">—</span>
                ) : (
                  <Badge tone={m.ownerKycTier >= 2 ? (m.ownerKycProvider === 'manual' ? 'warn' : 'ok') : 'muted'}>
                    {`tier ${m.ownerKycTier}${m.ownerKycProvider ? ` · ${m.ownerKycProvider}` : ''}`}
                  </Badge>
                )}
              </Td>
              <Td>{m.payoutRail}</Td>
              <Td>
                <Badge tone={m.status === 'online' ? 'ok' : m.status === 'suspended' ? 'danger' : 'muted'}>
                  {m.suspendReason === 'exited' ? 'exited' : m.suspendReason === 'bond' ? 'under floor' : m.status}
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
            {/* The submission itself. Shown for EVERY decided state, not just open ones: approving a
                business nobody can read is the first bug this row prevents, and "what did we actually
                approve this person on?" six weeks later is the second — which matters more now that an
                approval can also be the identity decision. Labels come from the same shared spec the
                form rendered, so reviewer and applicant read identical words. */}
            {m.kybFields ? (
              <tr className="bg-surface-low/40">
                <td colSpan={12} className="px-3 pb-2 pt-0">
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
