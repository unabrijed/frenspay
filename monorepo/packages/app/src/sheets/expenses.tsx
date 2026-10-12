'use client';

import { useEffect, useRef, useState } from 'react';
import {
  allocateExpense,
  BN,
  settleExpense,
  usd,
  type ApiExpense,
  type ExpensePayment,
  type SavedFriend,
} from '@fpay/shared';
import {
  Btn,
  Chip,
  colors,
  Field,
  Grab,
  Input,
  List,
  Row,
  RowAmount,
  RowMeta,
  SheetBody,
  SheetHeader,
  TextLink,
  Txt,
  type,
  View,
} from '@fpay/ui';
import { expensesApi, friendsApi } from '../services/api';
import { friendlyError } from '../lib/errors';
import { usePayStore } from '../store';
import { PeopleSearch } from './friends';
import { MaskedAmount } from '../components/MaskedAmount';

const exactMoney = (v: string) => (new BN(v).decimalPlaces()! > 2 ? `$${new BN(v).toFixed(6)}` : usd(v));

export function ExpenseShortcuts() {
  const open = usePayStore((s) => s.open);
  return (
    <View style={{ flexDirection: 'row', gap: 20, marginTop: 16, marginBottom: 12 }}>
      <TextLink label="Friends" onPress={() => open('friends')} />
      <TextLink label="Bills & splits" onPress={() => open('bills')} />
    </View>
  );
}

export function FriendsManager() {
  const close = usePayStore((s) => s.close);
  const [friends, setFriends] = useState<SavedFriend[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const load = async () => {
    try {
      setFriends((await friendsApi.list()).friends);
      setError('');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const change = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
      setAdding(false);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Grab />
      <SheetHeader title="Friends" onClose={close} />
      <SheetBody>
        <Txt style={type.sub}>Your saved people. Add someone by username or phone number.</Txt>
        {loading ? <Txt style={type.sub}>Loading…</Txt> : null}
        {friends.map((f) => (
          <View key={f.userId} style={{ marginTop: 16, gap: 8 }}>
            <Txt style={type.rowName}>{f.name}</Txt>
            <Txt style={type.rowTime}>{f.handle}</Txt>
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <TextLink
                label={f.favorite ? 'Unfavorite' : 'Favorite'}
                onPress={() => void change(() => friendsApi.save(f.handle, !f.favorite))}
              />
              <TextLink label="Remove" onPress={() => void change(() => friendsApi.remove(f.userId))} />
            </View>
          </View>
        ))}
        {!loading && !friends.length ? <Txt style={[type.sub, { marginTop: 16 }]}>No saved friends yet.</Txt> : null}
        {adding ? (
          <View style={{ marginTop: 20 }}>
            <PeopleSearch manage={false} onPick={(f) => void change(() => friendsApi.save(f.handle))} />
            <TextLink label="Done adding" onPress={() => setAdding(false)} />
          </View>
        ) : (
          <Btn
            label="Add a friend"
            disabled={busy}
            variant="secondary"
            onPress={() => setAdding(true)}
            style={{ marginTop: 20 }}
          />
        )}
        {error ? (
          <>
            <Txt style={[type.sub, { color: colors.danger }]}>{error}</Txt>
            <TextLink label="Retry" onPress={() => void load()} />
          </>
        ) : null}
      </SheetBody>
    </>
  );
}

export function Bills() {
  const close = usePayStore((s) => s.close),
    open = usePayStore((s) => s.open),
    setExpense = usePayStore((s) => s.setExpense);
  const hideAmounts = usePayStore((s) => s.hideAmounts);
  const [cursor, setCursor] = useState<string | undefined>();
  const [bills, setBills] = useState<ApiExpense[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const load = async (more = false) => {
    setLoading(true);
    try {
      const page = await expensesApi.list(more ? cursor : undefined);
      setBills((prev) =>
        more ? [...prev, ...page.expenses.filter((e) => !prev.some((p) => p.id === e.id))] : page.expenses,
      );
      setCursor(page.nextCursor);
      setError('');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <Grab />
      <SheetHeader title="Bills & splits" onClose={close} />
      <SheetBody>
        <Txt style={type.sub}>
          Bills you’re part of, including those outside your trips. Start a new split from a completed payment in
          Activity.
        </Txt>
        {loading ? <Txt style={type.sub}>Loading…</Txt> : null}
        {!loading && !bills.length ? <Txt style={[type.sub, { marginTop: 20 }]}>No bills yet.</Txt> : null}
        <List>
          {bills.map((bill) => (
            <Row
              key={bill.id}
              onPress={() => {
                setExpense({
                  id: bill.id,
                  expenseId: bill.id,
                  amountUsd: Number(bill.totalUsd),
                  label: bill.note,
                  groupId: bill.groupId,
                });
                open('split');
              }}
            >
              <RowMeta>
                <Txt style={type.rowName}>{bill.note}</Txt>
                <Txt style={type.rowTime}>
                  {bill.needsReview
                    ? 'Payment needs review'
                    : bill.state === 'draft'
                      ? 'Draft · awaiting review'
                      : bill.settlements.some((s) => s.status === 'pending')
                        ? 'Settlement pending'
                        : bill.settlements.some((s) => s.status === 'open')
                          ? 'People still owe'
                          : 'Everyone settled'}
                </Txt>
              </RowMeta>
              <RowAmount>
                <MaskedAmount value={usd(bill.totalUsd)} style={type.rowAmount} />
                <Txt style={type.rowTime}>your share {hideAmounts ? '••••' : usd(bill.yourShareUsd)}</Txt>
              </RowAmount>
            </Row>
          ))}
        </List>
        {cursor ? (
          <Btn label="Load more bills" disabled={loading} variant="secondary" onPress={() => void load(true)} />
        ) : null}
        {error ? (
          <>
            <Txt style={[type.sub, { color: colors.danger }]}>{error}</Txt>
            <TextLink label="Retry" onPress={() => void load()} />
          </>
        ) : null}
      </SheetBody>
    </>
  );
}

interface DraftPerson {
  handle: string;
  shareUsd: string;
}
export function ExpenseSheet() {
  const context = usePayStore((s) => s.expense),
    close = usePayStore((s) => s.close),
    me = usePayStore((s) => s.handle);
  const groups = usePayStore((s) => s.groups),
    refresh = usePayStore((s) => s.refresh),
    payRequest = usePayStore((s) => s.payRequest);
  const paymentBusy = usePayStore((s) => s.busy),
    hideAmounts = usePayStore((s) => s.hideAmounts),
    toggleHideAmounts = usePayStore((s) => s.toggleHideAmounts);
  const money = (value: string) => (hideAmounts ? '••••' : exactMoney(value));
  const busyRef = useRef(false);
  const [paymentCursor, setPaymentCursor] = useState<string | undefined>();
  const [bill, setBill] = useState<ApiExpense | null>(null),
    [people, setPeople] = useState<DraftPerson[]>([]);
  const [note, setNote] = useState(''),
    [group, setGroup] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false),
    [custom, setCustom] = useState(false),
    [review, setReview] = useState<ApiExpense | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [adding, setAdding] = useState(false);
  const [paymentOptions, setPaymentOptions] = useState<ExpensePayment[] | null>(null),
    [reload, setReload] = useState(0);
  const accept = (e: ApiExpense) => {
    setBill(e);
    setPeople(e.participants.map((p) => ({ handle: p.handle, shareUsd: new BN(p.shareUsd).toFixed() })));
    setNote(e.note);
    setGroup(e.groupId ?? null);
    setDirty(false);
    setCustom(e.allocationMode === 'custom');
  };
  useEffect(() => {
    let alive = true;
    setError('');
    setReview(null);
    setPaymentOptions(null);
    setBill(null);
    if (!context) return;
    void (async () => {
      try {
        const e = context.expenseId
          ? await expensesApi.get(context.expenseId)
          : ((await expensesApi.forTransfer(context.id)).expense ??
            (await expensesApi.create(context.id, context.groupId)));
        if (alive) accept(e);
      } catch (e) {
        if (alive) setError(friendlyError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [context?.id, context?.expenseId, reload]);
  useEffect(() => {
    if (!bill || dirty || busy) return;
    let alive = true;
    const timer = setInterval(() => {
      void expensesApi
        .get(bill.id)
        .then((e) => {
          if (!alive) return;
          if (review) {
            if (
              JSON.stringify([e.version, e.locked, e.needsReview, e.participants, e.payments]) !==
              JSON.stringify([review.version, review.locked, review.needsReview, review.participants, review.payments])
            ) {
              setReview(null);
              accept(e);
              setError('This bill changed. Review the updated split before confirming.');
            }
          } else accept(e);
        })
        .catch(() => {});
    }, 12000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [bill?.id, dirty, busy, review]);
  let allocations: Map<string, string> | null = null;
  try {
    if (bill)
      allocations = allocateExpense(
        bill.totalUsd,
        people.map((p) => p.handle),
        bill.creatorHandle,
        new Map(people.map((p) => [p.handle, p.shareUsd])),
      );
  } catch {
    /* display validation below */
  }
  const canEdit = !!bill?.canEdit && !busy;
  const update = (next: DraftPerson[], equal = false) => {
    if (equal && bill) {
      const shares = allocateExpense(
        bill.totalUsd,
        next.map((p) => p.handle),
        bill.creatorHandle,
      );
      next = next.map((p) => ({ ...p, shareUsd: shares.get(p.handle)! }));
    }
    setPeople(next);
    setDirty(true);
    setReview(null);
  };
  const add = (handles: string[]) => {
    const next = [...people];
    for (const handle of handles) if (!next.some((p) => p.handle === handle)) next.push({ handle, shareUsd: '0' });
    if (next.length > 21) {
      setError('A bill can include up to 21 people.');
      return;
    }
    update(next, !custom);
    setAdding(false);
  };
  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = async () => {
    if (!bill || !allocations) throw new Error('shares_exceed_amount');
    const result = dirty
      ? await expensesApi.edit(bill.id, {
          version: bill.version,
          equal: !custom,
          note,
          groupId: group,
          participants: people.map((p) => ({ handle: p.handle, shareUsd: allocations!.get(p.handle) })),
        })
      : bill;
    accept(result);
    void refresh();
    return result;
  };
  const edges = review
    ? settleExpense(review.participants.map((p) => ({ userId: p.handle, shareUsd: p.shareUsd, paidUsd: p.paidUsd })))
    : [];
  return (
    <>
      <Grab />
      <SheetHeader title={bill?.note ?? 'Split bill'} onClose={close} />
      <SheetBody>
        {!bill && !error ? <Txt style={type.sub}>Loading bill…</Txt> : null}
        {bill ? (
          <>
            <MaskedAmount value={exactMoney(bill.totalUsd)} style={[type.rowAmount, { fontSize: 26 }]} />
            {hideAmounts ? <TextLink label="Show amounts to edit shares" onPress={toggleHideAmounts} /> : null}
            {busy ? <Txt style={type.sub}>Saving changes…</Txt> : null}
            <Txt style={type.sub}>
              {bill.state === 'draft'
                ? 'Draft · no active payment requests'
                : 'Bill paid · reimbursements tracked below'}
            </Txt>
            {bill.needsReview ? (
              <Txt style={[type.sub, { color: colors.danger }]}>
                A linked payment is no longer eligible. This bill needs review; further settlement is paused.
              </Txt>
            ) : null}
            {bill.locked ? <Txt style={type.sub}>Settlement has started. The amounts are fixed.</Txt> : null}
            {canEdit ? (
              <>
                <Field>
                  <Input
                    value={note}
                    onChangeText={(v) => {
                      setNote(v);
                      setDirty(true);
                      setReview(null);
                    }}
                    maxLength={80}
                    placeholder="What was this for?"
                  />
                </Field>
                <Txt style={[type.eyebrow, { marginTop: 16 }]}>Organize in a trip</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip
                    label="Personal"
                    on={!group}
                    onPress={() => {
                      setGroup(null);
                      setDirty(true);
                      setReview(null);
                    }}
                  />
                  {groups.map((g) => (
                    <Chip
                      key={g.id}
                      label={g.name}
                      on={group === g.id}
                      onPress={() => {
                        setGroup(g.id);
                        setDirty(true);
                        setReview(null);
                      }}
                    />
                  ))}
                </View>
              </>
            ) : null}
            <Txt style={[type.eyebrow, { marginTop: 20 }]}>Each person’s share</Txt>
            {people.map((p) => {
              const initial = p.handle === bill.creatorHandle;
              const existing = bill.participants.find((x) => x.handle === p.handle);
              const contributed = existing && bill.payments.some((x) => x.userId === existing.userId);
              return (
                <View key={p.handle} style={{ marginTop: 12, gap: 6 }}>
                  <Txt style={type.rowName}>
                    {p.handle}
                    {p.handle === me ? ' (you)' : ''}
                    {initial ? ' · remainder' : ''}
                  </Txt>
                  {canEdit && !initial && !hideAmounts ? (
                    <Field>
                      <Input
                        value={p.shareUsd}
                        keyboardType="decimal"
                        accessibilityLabel={`Share for ${p.handle}`}
                        onChangeText={(v) => {
                          setCustom(true);
                          update(people.map((x) => (x.handle === p.handle ? { ...x, shareUsd: v } : x)));
                        }}
                      />
                    </Field>
                  ) : (
                    <MaskedAmount
                      value={allocations ? exactMoney(allocations.get(p.handle)!) : '-'}
                      style={type.rowAmount}
                    />
                  )}
                  {group ? (
                    <Txt style={type.rowTime}>
                      {(
                        bill.state === 'published' && !dirty
                          ? existing?.tripMember
                          : groups.find((g) => g.id === group)?.members.some((m) => m.handle === p.handle)
                      )
                        ? 'Counts toward trip cost'
                        : 'Outside this trip · shown on this bill only'}
                    </Txt>
                  ) : null}
                  {canEdit && !initial && !contributed ? (
                    <TextLink
                      label="Remove from bill"
                      onPress={() =>
                        update(
                          people.filter((x) => x.handle !== p.handle),
                          !custom,
                        )
                      }
                    />
                  ) : null}
                </View>
              );
            })}
            {!allocations ? (
              <Txt style={[type.sub, { color: colors.danger }]}>
                Check the amounts. Shares must fit within the bill.
              </Txt>
            ) : null}
            {canEdit ? (
              <View style={{ gap: 12, marginTop: 18 }}>
                <Txt style={type.sub}>
                  Any unallocated amount stays with {bill.creatorHandle}. Adding someone keeps your manual adjustments.
                </Txt>
                <TextLink
                  label="Split equally again"
                  onPress={() => {
                    setCustom(false);
                    update(people, true);
                  }}
                />
                {adding ? (
                  <>
                    <PeopleSearch
                      manage={false}
                      groupId={group ?? undefined}
                      onPick={(p) => add([p.handle])}
                      onPickGroup={(id) => add(groups.find((g) => g.id === id)?.members.map((m) => m.handle) ?? [])}
                    />
                    <TextLink label="Done adding" onPress={() => setAdding(false)} />
                  </>
                ) : (
                  <TextLink label="Add people" onPress={() => setAdding(true)} />
                )}
                <Btn
                  label="Save draft"
                  variant="secondary"
                  disabled={busy || !allocations || !note.trim() || !dirty}
                  onPress={() =>
                    void run(async () => {
                      await save();
                    })
                  }
                />
                <Btn
                  label="Review split"
                  disabled={busy || !allocations || !note.trim()}
                  onPress={() =>
                    void run(async () => {
                      const saved = await save();
                      setReview(saved);
                    })
                  }
                />
              </View>
            ) : null}
            {review ? (
              <View style={{ gap: 10, marginTop: 20 }}>
                <Txt style={type.eyebrow}>Review reimbursements</Txt>
                {edges.length ? (
                  edges.map((edge) => (
                    <Txt key={`${edge.fromUserId}:${edge.toUserId}`} style={type.sub}>
                      {edge.fromUserId} pays {edge.toUserId} {money(edge.amountUsd)}
                    </Txt>
                  ))
                ) : (
                  <Txt style={type.sub}>Everyone has already covered their share.</Txt>
                )}
                <Btn
                  label="Confirm split & send requests"
                  disabled={busy || dirty || !bill.canEdit || bill.needsReview || bill.locked}
                  onPress={() =>
                    void run(async () => {
                      if (!review) return;
                      accept(await expensesApi.publish(review.id, review.version));
                      setReview(null);
                      void refresh();
                    })
                  }
                />
              </View>
            ) : null}
            <Txt style={[type.eyebrow, { marginTop: 24 }]}>Payments toward this bill</Txt>
            {bill.payments.map((p) => (
              <View key={p.transferId} style={{ marginTop: 10, gap: 5 }}>
                <Txt style={type.sub}>
                  {p.handle} paid {money(p.amountUsd)}
                </Txt>
                {p.amountFiat && p.fiatCurrency ? (
                  <Txt style={type.rowTime}>
                    {hideAmounts ? '••••' : p.amountFiat} {p.fiatCurrency}
                  </Txt>
                ) : null}
                {!busy && !bill.needsReview && !bill.locked && p.handle === me && p.transferId !== bill.id ? (
                  <TextLink
                    label="Unlink payment"
                    onPress={() =>
                      void run(async () => {
                        if (dirty) {
                          setError('Save your draft before unlinking payments.');
                          return;
                        }
                        accept(await expensesApi.unlink(bill.id, p.transferId, bill.version));
                        setReview(null);
                        void refresh();
                      })
                    }
                  />
                ) : null}
              </View>
            ))}
            {!busy && !bill.locked && !bill.needsReview && bill.participants.some((p) => p.handle === me) ? (
              <View style={{ marginTop: 12, gap: 10 }}>
                <TextLink
                  label="Link another payment I made"
                  onPress={() =>
                    void run(async () => {
                      if (dirty) {
                        setError('Save your draft before linking payments.');
                        return;
                      }
                      const page = await expensesApi.payments();
                      setPaymentOptions(page.payments);
                      setPaymentCursor(page.nextCursor);
                    })
                  }
                />
                {paymentOptions?.length === 0 ? (
                  <Txt style={type.sub}>No other completed Frenspay payments available.</Txt>
                ) : null}
                {paymentOptions?.map((p) => (
                  <TextLink
                    key={p.transferId}
                    label={`${money(p.amountUsd)} · ${p.payeeName ?? 'Payment'} · ${new Date(p.createdAt).toLocaleDateString()}`}
                    onPress={() =>
                      void run(async () => {
                        accept(await expensesApi.link(bill.id, p.transferId, bill.version));
                        setPaymentOptions(null);
                        setReview(null);
                        void refresh();
                      })
                    }
                  />
                ))}
                {paymentCursor && paymentOptions ? (
                  <TextLink
                    label="Load more payments"
                    onPress={() =>
                      void run(async () => {
                        const page = await expensesApi.payments(paymentCursor);
                        setPaymentOptions([...paymentOptions, ...page.payments]);
                        setPaymentCursor(page.nextCursor);
                      })
                    }
                  />
                ) : null}
                {paymentOptions ? <TextLink label="Close payments" onPress={() => setPaymentOptions(null)} /> : null}
              </View>
            ) : null}
            <Txt style={[type.eyebrow, { marginTop: 24 }]}>Reimbursements</Txt>
            {bill.settlements
              .filter((s) => s.status !== 'cancelled')
              .map((s) => (
                <View key={s.id} style={{ marginTop: 12, gap: 8 }}>
                  <Txt style={type.sub}>
                    {s.fromHandle} → {s.toHandle} · {money(s.amountUsd)}
                  </Txt>
                  <Txt style={type.rowTime}>
                    {s.legacyRecorded
                      ? 'Previously recorded as paid'
                      : s.status === 'pending'
                        ? 'Waiting for confirmation'
                        : s.status === 'paid'
                          ? 'Paid'
                          : 'Unpaid'}
                  </Txt>
                  {s.fromHandle === me && s.status === 'open' && !bill.needsReview ? (
                    <Btn
                      label={`Pay ${money(s.amountUsd)} to ${s.toHandle}`}
                      variant="secondary"
                      disabled={busy || paymentBusy}
                      onPress={() =>
                        void run(async () => {
                          await payRequest(s.id);
                          accept(await expensesApi.get(bill.id));
                        })
                      }
                    />
                  ) : null}
                </View>
              ))}
            {bill.state === 'published' &&
            !bill.settlements.some((s) => s.status === 'open' || s.status === 'pending') ? (
              <Txt style={type.sub}>Everyone settled.</Txt>
            ) : null}
          </>
        ) : null}
        {error ? (
          <View style={{ marginTop: 16, gap: 10 }}>
            <Txt style={[type.sub, { color: colors.danger }]}>{error}</Txt>
            <TextLink
              label="Reload bill"
              onPress={() => {
                setReview(null);
                setReload((n) => n + 1);
              }}
            />
          </View>
        ) : null}
      </SheetBody>
    </>
  );
}
