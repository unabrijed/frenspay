// mappers.ts — convert the API wire shape (ApiTxn) to the UI shape (Txn).
import type { ApiTxn, Txn } from '@fpay/shared';
import { truncateAddress } from '@fpay/shared';

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

/**
 * The parse boundary. `ApiTxn.amountUsd` is a canonical decimal string; `Txn` is the VIEW model and
 * stays a `number`, because everything downstream of here only formats and renders it. Doing the
 * Number() once, here, is what keeps it out of TxCard / detail / home / activity.
 */
export function apiTxnToTxn(t: ApiTxn): Txn {
  const amount = Number(t.amountUsd);
  const usd = t.direction === 'out' ? -amount : amount;
  // External counterparties (no fpay handle) render as a truncated wallet address.
  const who = t.counterpartyHandle ?? (t.counterpartyAddress ? truncateAddress(t.counterpartyAddress) : undefined);
  let title: string;
  if (t.kind === 'add') title = 'Added money';
  else if (t.kind === 'send') title = (t.direction === 'out' ? 'To ' : 'From ') + (who ?? 'wallet');
  else title = who ?? t.note ?? 'Payment';
  return { id: t.id, type: t.kind, title, time: relTime(t.createdAt), usd, status: t.status };
}
