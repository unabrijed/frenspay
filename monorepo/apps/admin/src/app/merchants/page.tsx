'use client';

// Merchants — every LP (real + sim) with the reputation signals routing ranks on, plus the
// admin actions: KYB approve/reject (pending only) and suspend/reinstate. Every action confirms
// first and lands in the audit trail server-side.
import { Fragment, useCallback, useState } from 'react';

import type { AdminMerchant, AdminStakeClaim, AdminStakeWithdrawal } from '@fpay/shared';
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
const shortAddr = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;

/** The claim's state in one badge. Once accepted, the transfers row's status is the truth. */
const claimTone = (c: AdminStakeClaim): 'ok' | 'warn' | 'danger' | 'muted' =>
  c.status === 'duplicate' || (c.status === 'accepted' && c.transferStatus === 'failed')
    ? 'danger'
    : c.status === 'accepted'
      ? 'ok'
      : c.status === 'rejected'
        ? 'muted'
        : 'warn';
const claimText = (c: AdminStakeClaim): string => {
  if (c.status === 'accepted') {
    if (c.transferStatus === 'failed') return 'failed on check';
    return c.transferStatus === 'confirmed' ? 'credited' : 'accepted · confirming';
  }
  if (c.status === 'duplicate') return c.transferId ? 'duplicate · already a recorded transfer' : 'duplicate';
  return c.status;
};

export default function Merchants() {
  const fetchMerchants = useCallback(() => api.merchants(), []);
  const { data, err, denied, reload } = usePoll(fetchMerchants, 15000);
  const fetchWithdrawals = useCallback(() => api.stakeWithdrawals('requested'), []);
  const { data: withdrawals, reload: reloadWithdrawals } = usePoll(fetchWithdrawals, 15000);
  const fetchClaims = useCallback(() => api.stakeClaims('open'), []);
  const { data: claims, reload: reloadClaims } = usePoll(fetchClaims, 15000);
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
      const ask = (what: string) => window.prompt(`${what}. This is shown to the merchant:`)?.trim();
      list.push(
        {
          title: `Approve KYB: ${m.name}`,
          // This approves the PARTNER and nothing else. It used to also grant the owner tier 2 while
          // the identity vendor was off; that was removed on 2026-08-29 (docs/14) because no partner
          // capability reads a tier — only payer ones do. The Identity column still shows where the
          // person stands, because admitting a partner the vendor never checked is worth seeing.
          body:
            m.ownerKycTier !== undefined && m.ownerKycTier < 2
              ? 'The details check out. Note this person has NOT passed an identity check. Approve on the strength of the details below, and only if they hold up. Their own payment limits are unchanged.'
              : 'The details check out. They can go online themselves whenever they like. Approval does NOT put them into routing.',
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
          body: 'Terminal. The merchant cannot resubmit. Prefer "Ask for more" unless the person is the problem.',
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
    // Let them work before staking (0028). Root admin only, 30 days, worth exactly the floor and never
    // leveraged; the first upheld dispute ends it. Sits where Approve was, so the row an admin has
    // just approved shows its next step without a hunt.
    if (m.real && m.kybStatus === 'approved' && m.suspendReason !== 'exited') {
      list.push(
        m.bondWaivedUntil
          ? {
              title: `End stake waiver: ${m.name}`,
              body: 'They go back under the floor. Routing stops at once; the next stats pass takes them offline unless they have staked by then.',
              confirmLabel: 'End waiver',
              danger: true,
              onConfirm: async () => {
                await api.merchantStakeWaiverEnd(m.id);
                await reload();
              },
            }
          : {
              title: `Waive stake: ${m.name}`,
              body: 'No collateral behind this partner. They can go online and carry $100 in flight as if staked. Ends in 30 days, or on the first upheld dispute. Root admin only; they are never told.',
              confirmLabel: 'Waive stake',
              onConfirm: async () => {
                const note = window.prompt('Why does this partner work before staking? Audit only, never shown to them:')?.trim();
                if (!note) return;
                await api.merchantStakeWaiver(m.id, note);
                await reload();
              },
            },
      );
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

  // Attribute a deposit to the partner who claimed it (docs/20). NOT a credit: the server inserts the
  // pending transfers row and the confirmer's chain check lands the bond — the chain decides the
  // money, this decides only whose. The confirm names the sender and any rival claimant, because the
  // treasury address is public and the first to paste is not necessarily the one who paid.
  const creditClaim = (c: AdminStakeClaim): Confirm => ({
    title: `Credit ${usd(c.amountUsdc)} to ${c.ownerHandle ? `@${c.ownerHandle}` : c.merchantName}`,
    body: `Sent from ${c.sender ?? 'an unknown wallet'}.${c.alsoClaimedBy ? ` ALSO CLAIMED BY ${c.alsoClaimedBy}. Credit only the one who actually paid.` : ''} The bond lands after the chain check, not now.`,
    confirmLabel: 'Credit',
    onConfirm: async () => {
      await api.creditStakeClaim(c.id);
      await Promise.all([reload(), reloadClaims()]);
    },
  });
  const rejectClaim = (c: AdminStakeClaim): Confirm => ({
    title: `Don’t credit: ${c.ownerHandle ? `@${c.ownerHandle}` : c.merchantName}`,
    body: 'The partner sees your reason. Rejecting frees the signature for whoever actually paid.',
    confirmLabel: 'Reject',
    danger: true,
    onConfirm: async () => {
      const note = window.prompt('Why is this not credited? This is shown to the partner:')?.trim();
      if (!note) return;
      await api.rejectStakeClaim(c.id, note);
      await reloadClaims();
    },
  });

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
      <PageHead title="Partners" sub="The people settling the fiat leg: reputation signals and lifecycle actions" />
      <ErrorBanner msg={err} />
      {/* Stake deposits waiting for a human (docs/20): a partner paid the treasury from somewhere and
          pasted the signature; the server read what it moved. Crediting ATTRIBUTES it — the confirmer's
          chain check lands the bond. A signature claimed twice shows BOTH rows, each naming the other. */}
      {claims && claims.claims.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium">Stake deposits to check</h2>
          <Table head={['Who', 'Amount seen', 'From', 'Paid', 'Signature', 'Status', '']}>
            {claims.claims.map((c) => (
              <Fragment key={c.id}>
                <tr className="hover:bg-surface-low">
                  <Td>{c.ownerHandle ? <Who handle={c.ownerHandle} email={c.ownerEmail} /> : <span className="font-medium">{c.merchantName}</span>}</Td>
                  <Td className="whitespace-nowrap">{usd(c.amountUsdc)}</Td>
                  <Td className="font-mono text-[12px]">{c.sender ? shortAddr(c.sender) : <span className="text-muted">-</span>}</Td>
                  <Td className="whitespace-nowrap">{c.paidAt ? new Date(c.paidAt).toLocaleString() : <span className="text-muted">-</span>}</Td>
                  <Td className="font-mono text-[12px]">
                    <a href={`https://solscan.io/tx/${c.signature}`} target="_blank" rel="noreferrer" className="underline">
                      {shortAddr(c.signature)}
                    </a>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={claimTone(c)}>{claimText(c)}</Badge>
                      {c.alsoClaimedBy ? <Badge tone="danger">{`also claimed by ${c.alsoClaimedBy}`}</Badge> : null}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {c.status !== 'accepted' ? (
                        <Btn variant="primary" onClick={() => setConfirm(creditClaim(c))}>
                          Credit
                        </Btn>
                      ) : null}
                      {c.status === 'submitted' || c.status === 'duplicate' ? (
                        <Btn variant="danger" onClick={() => setConfirm(rejectClaim(c))}>
                          Reject
                        </Btn>
                      ) : null}
                    </div>
                  </Td>
                </tr>
                {/* The whole record, for the decision: full sender, memo (a partner may have put their
                    @handle in it), when it was submitted, and the transfer's status once accepted. */}
                <tr className="bg-surface-low/40">
                  <td colSpan={7} className="px-3 pb-2 pt-0">
                    <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-[12px] text-muted">
                      {c.sender ? (
                        <span>
                          Sender: <span className="font-mono text-ink">{c.sender}</span>
                        </span>
                      ) : null}
                      {c.memo ? (
                        <span>
                          Memo: <span className="text-ink">{c.memo}</span>
                        </span>
                      ) : null}
                      <span>
                        Submitted: <span className="text-ink">{new Date(c.createdAt).toLocaleString()}</span>
                      </span>
                      {c.transferStatus ? (
                        <span>
                          Transfer: <span className="text-ink">{c.transferStatus}</span>
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
          </Table>
        </div>
      ) : null}
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
              <Td>{m.ownerHandle ? <Who handle={m.ownerHandle} email={m.ownerEmail} /> : <span className="text-muted">-</span>}</Td>
              {/* The reviewer's only way to reach a human about the application in front of them. */}
              <Td>{m.contactPhone ?? <span className="text-muted">-</span>}</Td>
              {/* Where the person stands, and who decided it. A partner sitting at tier 1 is normal
                  while the vendor is off — nothing a partner does reads a tier. It is shown so a
                  reviewer knows an identity check has not happened, not because it blocks anything. */}
              <Td className="whitespace-nowrap">
                {m.ownerKycTier === undefined ? (
                  <span className="text-muted">-</span>
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
                <div className="flex flex-wrap gap-1">
                  <Badge tone={m.kybStatus === 'approved' ? 'ok' : m.kybStatus === 'rejected' ? 'danger' : 'warn'}>
                    {m.kybStatus}
                  </Badge>
                  {/* An approved partner edited one of the fields that matter and is back in the queue:
                      re-check THAT, not the whole form (the spec's `recheck` fields). */}
                  {m.kybRecheck?.length ? (
                    <Badge tone="warn">
                      {`re-check: ${m.kybRecheck.map((k) => (KYB_FIELDS[m.country] ?? []).find((f) => f.key === k)?.label ?? k).join(', ')}`}
                    </Badge>
                  ) : null}
                </div>
              </Td>
              <Td className="whitespace-nowrap">
                <div className="flex flex-wrap items-center gap-1">
                  {usd(m.bondUsdc)}
                  {/* Exposure, not health: a warn tone on purpose. */}
                  {m.bondWaivedUntil ? <Badge tone="warn">{`waived to ${new Date(m.bondWaivedUntil).toLocaleDateString()}`}</Badge> : null}
                </div>
              </Td>
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
