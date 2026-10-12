import { BN, type Amount } from './units';

export interface SavedFriend {
  userId: string;
  handle: string;
  name: string;
  favorite: boolean;
}
export interface SuggestedPerson extends SavedFriend {
  saved: boolean;
  reason: 'trip' | 'favorite' | 'routine' | 'frequent' | 'recent';
}
export interface PeopleSuggestions {
  people: SuggestedPerson[];
  groups: { id: string; name: string }[];
}
export interface ExpenseParticipant {
  userId: string;
  handle: string;
  name: string;
  shareUsd: string;
  paidUsd: string;
  tripMember: boolean;
}
export interface ExpensePayment {
  transferId: string;
  userId: string;
  handle: string;
  amountUsd: string;
  payeeName?: string;
  createdAt: string;
  amountFiat?: string;
  fiatCurrency?: string;
  eligible: boolean;
}
export interface ExpenseSettlement {
  id: string;
  fromUserId: string;
  toUserId: string;
  fromHandle: string;
  toHandle: string;
  amountUsd: string;
  status: 'open' | 'pending' | 'paid' | 'cancelled';
  transferId?: string;
  legacyRecorded?: boolean;
}
export interface ApiExpense {
  id: string;
  creatorUserId: string;
  creatorHandle: string;
  groupId?: string;
  note: string;
  state: 'draft' | 'published';
  version: number;
  allocationMode: 'equal' | 'custom';
  totalUsd: string;
  memberCostUsd: string;
  yourShareUsd: string;
  createdAt: string;
  locked: boolean;
  needsReview: boolean;
  canEdit: boolean;
  participants: ExpenseParticipant[];
  payments: ExpensePayment[];
  settlements: ExpenseSettlement[];
}
export interface ExpenseEdit {
  version: number;
  note?: string;
  groupId?: string | null;
  /** Includes the initial payer, whose amount is always calculated as the remainder. */
  participants?: { handle: string; shareUsd?: string }[];
  equal?: boolean;
}
export interface SettlementBalance {
  userId: string;
  shareUsd: string;
  paidUsd: string;
}
export interface SettlementEdge {
  fromUserId: string;
  toUserId: string;
  amountUsd: string;
}

export function expenseAmount(value: unknown): Amount {
  if (typeof value !== 'string' || !/^\d{1,14}(\.\d{1,6})?$/.test(value)) throw new Error('invalid_amount');
  const n = new BN(value);
  if (!n.isFinite() || n.isNegative()) throw new Error('invalid_amount');
  return n;
}

/** Exact ledger arithmetic; only the initial payer absorbs fractional cents. */
export function allocateExpense(
  total: string,
  ids: string[],
  payer: string,
  custom?: Map<string, string>,
): Map<string, string> {
  if (!ids.length || ids.length > 21 || new Set(ids).size !== ids.length || !ids.includes(payer))
    throw new Error('invalid_participants');
  const amount = expenseAmount(total);
  const each = amount.div(ids.length).decimalPlaces(2, BN.ROUND_DOWN);
  let remainder = amount;
  const shares = new Map<string, string>();
  for (const id of ids.filter((id) => id !== payer)) {
    const share = custom ? expenseAmount(custom.get(id) ?? '0') : each;
    remainder = remainder.minus(share);
    shares.set(id, share.toFixed(6));
  }
  if (remainder.isNegative()) throw new Error('shares_exceed_amount');
  shares.set(payer, remainder.toFixed(6));
  return shares;
}

/** Stable greedy matching within ONE bill. No transfer or trip netting is performed here. */
export function settleExpense(balances: SettlementBalance[]): SettlementEdge[] {
  if (new Set(balances.map((b) => b.userId)).size !== balances.length) throw new Error('invalid_participants');
  const net = balances.map((b) => ({ id: b.userId, value: expenseAmount(b.paidUsd).minus(expenseAmount(b.shareUsd)) }));
  if (!net.reduce((n, b) => n.plus(b.value), new BN(0)).isZero()) throw new Error('unbalanced_expense');
  const sort = (a: { id: string; value: Amount }, b: { id: string; value: Amount }) =>
    b.value.comparedTo(a.value) || a.id.localeCompare(b.id);
  const creditors = net.filter((b) => b.value.gt(0)).sort(sort);
  const debtors = net
    .filter((b) => b.value.lt(0))
    .map((b) => ({ ...b, value: b.value.negated() }))
    .sort(sort);
  const result: SettlementEdge[] = [];
  let c = 0;
  for (const debtor of debtors) {
    while (debtor.value.gt(0)) {
      const creditor = creditors[c];
      const amount = BN.minimum(debtor.value, creditor.value);
      result.push({ fromUserId: debtor.id, toUserId: creditor.id, amountUsd: amount.toFixed(6) });
      debtor.value = debtor.value.minus(amount);
      creditor.value = creditor.value.minus(amount);
      if (creditor.value.isZero()) c++;
    }
  }
  return result;
}

export interface SuggestionSignal {
  userId: string;
  trip: boolean;
  favorite: boolean;
  routineCount: number;
  count: number;
  lastAt: number;
}
export function rankPeople<T extends SuggestionSignal>(people: T[]): T[] {
  return [...people].sort(
    (a, b) =>
      Number(b.trip) - Number(a.trip) ||
      Number(b.favorite) - Number(a.favorite) ||
      Number(b.routineCount >= 3) - Number(a.routineCount >= 3) ||
      b.count - a.count ||
      b.lastAt - a.lastAt ||
      a.userId.localeCompare(b.userId),
  );
}
