// mappers.ts — convert the API wire shape (ApiTxn) to the UI shape (Txn).
import type { ApiTxn, Txn } from '@pay/shared';

/** Human-friendly relative time for the activity rows. */
export function relTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return 'Today · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function apiTxnToTxn(t: ApiTxn): Txn {
  const usd = t.direction === 'out' ? -t.amountUsd : t.amountUsd;
  let title: string;
  if (t.kind === 'add') title = 'Added money';
  else if (t.kind === 'send') title = (t.direction === 'out' ? 'To ' : 'From ') + (t.counterpartyHandle ?? '');
  else title = t.counterpartyHandle ?? t.note ?? 'Payment';
  return { id: t.id, type: t.kind, title, time: relTime(t.createdAt), usd, status: t.status };
}
