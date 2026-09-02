// mappers.ts — convert the API wire shape (ApiTxn) to the UI shape (Txn).
import { type ApiTxn, truncateAddress, type Txn, type TxnType } from '@fpay/shared';

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

/** The detail page's date line: "14 Jun, 09:24". */
export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Same calendar month as now, in the viewer's zone — what "Spent this month" sums. */
export function isThisMonth(iso: string | undefined): boolean {
  if (!iso) return true; // an optimistic row is by definition from just now
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
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
  // The escrow kinds fold into the three view kinds: a scan-and-pay debit IS a payment (titled by the
  // place, never by the pool's address), and a refund is money back in.
  const refund = t.kind === 'escrow_release' && t.note === 'refund';
  const type: TxnType = t.kind === 'escrow_fund' ? 'pay' : t.kind === 'escrow_release' ? 'add' : t.kind;
  let title: string;
  if (refund) title = 'Refunded';
  else if (type === 'add') title = t.kind === 'escrow_release' ? 'Received' : 'Added money';
  else if (type === 'send') title = (t.direction === 'out' ? 'To ' : 'From ') + (who ?? 'wallet');
  else title = t.payeeName ?? who ?? t.note ?? 'Payment';
  return {
    id: t.id,
    type,
    title,
    time: relTime(t.createdAt),
    createdAt: t.createdAt,
    usd,
    status: t.status,
    // ponytail: the detail page's fiat line is rupees-only until Txn carries a currency; IDR rows show dollars.
    rupees: t.amountFiat && t.fiatCurrency === 'INR' ? Number(t.amountFiat) : undefined,
    groupId: t.groupId,
    yourPart: t.yourPartUsd === undefined ? undefined : Number(t.yourPartUsd),
    settlesNote: t.settlesNote,
  };
}
