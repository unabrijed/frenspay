'use client';

// groups.tsx — trips & circles (docs/04 §Trips, circles and splitting): the trip sheet, and the
// four small sheets around an expense — new trip, add someone, move, split. An expense is a transfer
// the payer put in a trip; a share is a request, so "who still owes" is the Requests block on
// Activity and, per expense, the line under each row here. Every total is the server's.
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { type ApiGroupExpense, BN, type SplitShareInput, splitEqual, usd } from '@fpay/shared';

import { Btn, Chip, colors, Fav, Field, Grab, Icons, Input, List, Pressable, Row, RowAmount, RowMeta, SheetBody, SheetHeader, Spacer, sx, TextLink, Txt, type, View } from '@fpay/ui';
import { MaskedAmount } from '../components/MaskedAmount';
import { Skeleton } from '../components/Skeleton';
import { relTime } from '../services/mappers';
import { usePayStore } from '../store';
import { PeopleSearch } from './friends';

const ini = (handle: string) => (handle.replace(/^@/, '')[0] ?? '?').toUpperCase();
const expenseTitle = (e: { payeeName?: string; note?: string }) => e.payeeName ?? e.note ?? 'Payment';

export function NewGroup() {
  const close = usePayStore((s) => s.close);
  const createGroup = usePayStore((s) => s.createGroup);
  const busy = usePayStore((s) => s.busy);
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const ok = trimmed.length > 0 && trimmed.length <= 40;
  return (
    <>
      <Grab />
      <SheetHeader title="New trip" onClose={close} />
      <SheetBody>
        <Txt style={[type.sub, { color: colors.muted }]}>
          A trip ends; a circle of friends doesn’t. Either way it’s a name and the people in it.
        </Txt>
        <Field style={{ marginTop: 16 }}>
          <Input
            value={name}
            onChangeText={setName}
            placeholder="Goa, the flat, Sunday football…"
            autoFocus
            maxLength={40}
            onSubmit={() => ok && !busy && void createGroup(trimmed)}
            style={inputStyle}
          />
        </Field>
        <Spacer />
        <View style={styles.cta}>
          <Btn label="Create" disabled={!ok || busy} onPress={() => void createGroup(trimmed)} />
        </View>
      </SheetBody>
    </>
  );
}

export function AddMember() {
  const close = usePayStore((s) => s.close);
  const trip = usePayStore((s) => s.trip);
  const addMember = usePayStore((s) => s.addMember);
  const busy = usePayStore((s) => s.busy);
  return (
    <>
      <Grab />
      <SheetHeader eyebrow={trip?.name} title="Add someone" onClose={close} />
      <SheetBody>
        <PeopleSearch onPick={(fr) => !busy && void addMember(fr.handle)} />
      </SheetBody>
    </>
  );
}

export function Trip() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const trip = usePayStore((s) => s.trip);
  const me = usePayStore((s) => s.handle);
  const setExpense = usePayStore((s) => s.setExpense);
  const removeMember = usePayStore((s) => s.removeMember);
  const deleteGroup = usePayStore((s) => s.deleteGroup);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const act = (e: ApiGroupExpense, sheet: 'split' | 'moveToGroup') => {
    setExpense({ id: e.transferId, amountUsd: Number(e.amountUsd), label: expenseTitle(e), groupId: trip?.id });
    open(sheet);
  };

  if (!trip) {
    return (
      <>
        <Grab />
        <SheetHeader title=" " onClose={close} />
        <SheetBody>
          <Skeleton w={180} h={22} r={8} />
          <Skeleton w="60%" h={13} style={{ marginTop: 10 }} />
          <Skeleton w="100%" h={64} r={12} style={{ marginTop: 18 }} />
        </SheetBody>
      </>
    );
  }
  const owner = trip.ownerHandle === me;
  const myId = trip.members.find((m) => m.handle === me)?.userId;
  return (
    <>
      <Grab />
      <SheetHeader eyebrow={`${trip.members.length} ${trip.members.length === 1 ? 'person' : 'people'}`} title={trip.name} onClose={close} />
      <SheetBody>
        {/* Who's in it. The owner can drop anyone but themselves; anyone can leave. */}
        <View style={styles.members}>
          {trip.members.map((m) => (
            <Pressable
              key={m.userId}
              disabled={!owner || m.handle === me}
              onPress={() => void removeMember(m.userId)}
              style={styles.member}
            >
              <Fav label={ini(m.handle)} />
              <Txt style={[type.rowTime, { marginTop: 4 }]}>{m.handle === me ? 'you' : m.handle.replace(/^@/, '')}</Txt>
            </Pressable>
          ))}
          <Pressable onPress={() => open('addMember')} style={styles.member}>
            <View style={styles.addCircle}>
              <Icons.Plus size={18} color={colors.accent} />
            </View>
            <Txt style={[type.rowTime, { marginTop: 4, color: colors.accent }]}>Add</Txt>
          </Pressable>
        </View>

        <View style={styles.totals}>
          <View>
            <Txt style={type.eyebrow}>Total</Txt>
            <MaskedAmount value={usd(trip.totalUsd)} style={[type.rowAmount, { fontSize: 20 }]} />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt style={type.eyebrow}>Your part</Txt>
            <MaskedAmount value={usd(trip.yourPartUsd)} style={[type.rowAmount, { fontSize: 20 }]} />
          </View>
        </View>

        {trip.expenses.length === 0 ? (
          <Txt style={[type.lead, { color: colors.muted, textAlign: 'center', marginTop: 24 }]}>
            Nothing here yet. Open a payment in Activity and add it to this trip.
          </Txt>
        ) : (
          <List style={{ marginTop: 14 }}>
            {trip.expenses.map((e) => {
              const mine = e.paidByHandle === me;
              return (
                <View key={e.transferId}>
                  <Row>
                    <Fav label={ini(e.paidByHandle)} />
                    <RowMeta>
                      <Txt style={type.rowName}>{expenseTitle(e)}</Txt>
                      <Txt style={[type.rowTime, { marginTop: 3 }]}>
                        paid by {mine ? 'you' : e.paidByHandle} · {relTime(e.createdAt)}
                      </Txt>
                      {e.shares.length > 0 ? (
                        <Txt style={[type.rowTime, { marginTop: 3, color: colors.muted }]}>
                          {e.shares.map((s) => `${s.handle} ${usd(s.amountUsd)} ${s.status}`).join(' · ')}
                        </Txt>
                      ) : null}
                    </RowMeta>
                    <RowAmount>
                      <MaskedAmount value={usd(e.amountUsd)} style={type.rowAmount} />
                      <Txt style={[type.rowTime, { marginTop: 2 }]}>your part {usd(e.yourPartUsd)}</Txt>
                    </RowAmount>
                  </Row>
                  {mine ? (
                    <View style={styles.rowActions}>
                      <TextLink label={e.shares.length ? 'Edit split' : 'Split'} onPress={() => act(e, 'split')} />
                      <TextLink label="Move" onPress={() => act(e, 'moveToGroup')} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </List>
        )}

        <Spacer />
        <View style={styles.cta}>
          {owner ? (
            confirmDelete ? (
              <>
                <Txt style={[type.sub, { color: colors.muted, textAlign: 'center' }]}>
                  Everyone loses the trip; its payments go back to personal. Shares still stand.
                </Txt>
                <Btn label="Delete for everyone" variant="ink" onPress={() => void deleteGroup()} />
                <TextLink label="Keep it" onPress={() => setConfirmDelete(false)} />
              </>
            ) : (
              <TextLink label="Delete trip" onPress={() => setConfirmDelete(true)} />
            )
          ) : myId ? (
            <TextLink label="Leave trip" onPress={() => void removeMember(myId)} />
          ) : null}
        </View>
      </SheetBody>
    </>
  );
}

export function MoveToGroup() {
  const close = usePayStore((s) => s.close);
  const expense = usePayStore((s) => s.expense);
  const groups = usePayStore((s) => s.groups);
  const moveExpense = usePayStore((s) => s.moveExpense);
  const busy = usePayStore((s) => s.busy);
  const current = expense?.groupId;
  const pick = (id: string | null) => {
    if (!busy && id !== (current ?? null)) void moveExpense(id);
  };
  return (
    <>
      <Grab />
      <SheetHeader eyebrow={expense?.label} title="Which trip?" onClose={close} />
      <SheetBody>
        <List>
          <Row onPress={() => pick(null)}>
            <RowMeta>
              <Txt style={type.rowName}>Personal</Txt>
              <Txt style={[type.rowTime, { marginTop: 3 }]}>Not part of a trip</Txt>
            </RowMeta>
            {current ? null : <Icons.Check size={18} color={colors.accent} />}
          </Row>
          {groups.map((g) => (
            <Row key={g.id} onPress={() => pick(g.id)}>
              <RowMeta>
                <Txt style={type.rowName}>{g.name}</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>{g.members.length} people</Txt>
              </RowMeta>
              {current === g.id ? <Icons.Check size={18} color={colors.accent} /> : null}
            </Row>
          ))}
        </List>
        {groups.length === 0 ? (
          <Txt style={[type.rowTime, { textAlign: 'center', marginTop: 18 }]}>No trips yet. Make one from Activity.</Txt>
        ) : null}
      </SheetBody>
    </>
  );
}

/* ---- split: who was this for, and how much each ---- */

interface Line {
  handle: string;
  on: boolean;
  amount: string;
  /** "Already paid" — recorded as paid, no request goes out. */
  settled: boolean;
  /** A transfer settled it: the server keeps it whatever we send, so it is shown, not edited. */
  locked: boolean;
}

/** Equal parts over the selected, unlocked lines, from what the locked ones leave. Overwrites
 *  hand-edited amounts — selection is the coarse control, the fields are the fine one after. */
function equalize(lines: Line[], totalUsd: number): Line[] {
  const locked = lines.filter((l) => l.locked).reduce((acc, l) => acc.plus(l.amount), new BN(0));
  const open = lines.filter((l) => l.on && !l.locked);
  if (open.length === 0) return lines;
  const parts = splitEqual(new BN(totalUsd).minus(locked).toFixed(2), open.length + 1).slice(1);
  let i = 0;
  return lines.map((l) => (l.on && !l.locked ? { ...l, amount: parts[i++] } : l));
}

export function Split() {
  const close = usePayStore((s) => s.close);
  const expense = usePayStore((s) => s.expense);
  const groups = usePayStore((s) => s.groups);
  const requests = usePayStore((s) => s.requests);
  const me = usePayStore((s) => s.handle);
  const busy = usePayStore((s) => s.busy);
  const splitExpense = usePayStore((s) => s.splitExpense);
  const total = expense?.amountUsd ?? 0;

  const [note, setNote] = useState(expense?.label ?? '');
  const [adding, setAdding] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => {
    if (!expense) return [];
    // What already exists on this expense (the store holds every request I sent), then the trip's
    // roster. A first split preselects the roster; a re-split shows exactly what stands.
    const existing: Line[] = requests
      .filter((r) => r.direction === 'outgoing' && r.splitOf === expense.id && r.status !== 'cancelled' && r.counterpartyHandle)
      .map((r) => ({
        handle: r.counterpartyHandle as string,
        on: true,
        amount: new BN(r.amountUsd).toFixed(2),
        settled: r.status === 'paid',
        locked: r.status === 'paid' && !!r.transferId,
      }));
    const roster = (groups.find((g) => g.id === expense.groupId)?.members ?? [])
      .filter((m) => m.handle !== me && !existing.some((l) => l.handle === m.handle))
      .map((m): Line => ({ handle: m.handle, on: existing.length === 0, amount: '', settled: false, locked: false }));
    const all = [...existing, ...roster];
    return existing.length === 0 ? equalize(all, total) : all;
  });

  if (!expense) return null;

  const update = (next: Line[], reequalize: boolean) => setLines(reequalize ? equalize(next, total) : next);
  const toggle = (h: string) => update(lines.map((l) => (l.handle === h ? { ...l, on: !l.on } : l)), true);
  const setAmount = (h: string, amount: string) => update(lines.map((l) => (l.handle === h ? { ...l, amount } : l)), false);
  const setSettled = (h: string) => update(lines.map((l) => (l.handle === h ? { ...l, settled: !l.settled } : l)), false);
  const add = (handle: string) => {
    setAdding(false);
    if (handle === me || lines.some((l) => l.handle === handle)) return;
    update([...lines, { handle, on: true, amount: '', settled: false, locked: false }], true);
  };

  const selected = lines.filter((l) => l.on);
  const valid = selected.every((l) => /^\d+(\.\d{1,2})?$/.test(l.amount) && new BN(l.amount).gt(0));
  const sum = valid ? selected.reduce((acc, l) => acc.plus(l.amount), new BN(0)) : null;
  const yourPart = sum ? new BN(total).minus(sum) : null;
  const ok = valid && yourPart !== null && yourPart.gte(0);
  const hadSplit = lines.some((l) => !l.locked && l.settled) || requests.some((r) => r.splitOf === expense.id && r.status === 'open');
  const shares: SplitShareInput[] = selected
    .filter((l) => !l.locked)
    .map((l) => ({ handle: l.handle, amountUsd: l.amount, settled: l.settled }));

  return (
    <>
      <Grab />
      <SheetHeader eyebrow={usd(total)} title="Split with" onClose={close} />
      <SheetBody>
        <Field>
          <Input value={note} onChangeText={setNote} placeholder="What was it? (they see this)" maxLength={80} style={inputStyle} />
        </Field>

        {lines.length === 0 && !adding ? (
          <Txt style={[type.rowTime, { textAlign: 'center', marginTop: 18 }]}>Add the people this was for.</Txt>
        ) : null}
        <List style={{ marginTop: 14 }}>
          {lines.map((l) => (
            <Row key={l.handle} onPress={l.locked ? undefined : () => toggle(l.handle)} style={l.on ? undefined : { opacity: 0.55 }}>
              <Fav label={ini(l.handle)} />
              <RowMeta>
                <Txt style={type.rowName}>{l.handle}</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>
                  {l.locked ? 'paid' : l.on ? (l.settled ? 'already paid' : 'will be asked') : 'not included'}
                </Txt>
              </RowMeta>
              {l.on ? (
                <View style={styles.lineRight}>
                  {l.locked ? (
                    <Txt style={type.rowAmount}>{usd(l.amount)}</Txt>
                  ) : (
                    <>
                      <Chip label="paid" on={l.settled} onPress={() => setSettled(l.handle)} />
                      <Field style={styles.amountField}>
                        <Input value={l.amount} onChangeText={(v) => setAmount(l.handle, v)} keyboardType="decimal" placeholder="0.00" style={sx(inputStyle, { textAlign: 'right' })} />
                      </Field>
                    </>
                  )}
                </View>
              ) : null}
            </Row>
          ))}
        </List>

        {adding ? (
          <View style={{ marginTop: 14 }}>
            <PeopleSearch onPick={(fr) => add(fr.handle)} />
            <TextLink label="Cancel" onPress={() => setAdding(false)} />
          </View>
        ) : (
          <View style={{ marginTop: 10, alignItems: 'flex-start' }}>
            <TextLink label="+ Add someone else" onPress={() => setAdding(true)} />
          </View>
        )}

        <View style={styles.yourPart}>
          <Txt style={type.eyebrow}>Your part</Txt>
          <Txt style={[type.rowAmount, { fontSize: 20, color: ok ? colors.ink : colors.danger }]}>
            {yourPart ? usd(yourPart.toFixed(2)) : '-'}
          </Txt>
          {!ok && sum ? <Txt style={[type.rowTime, { color: colors.danger }]}>The parts add up to more than the bill.</Txt> : null}
        </View>

        <Spacer />
        <View style={styles.cta}>
          <Btn label={shares.length ? `Ask ${shares.filter((s) => !s.settled).length || 'no one'} · save` : 'Save'} disabled={!ok || busy || (shares.length === 0 && !hadSplit)} onPress={() => void splitExpense(shares, note.trim() || undefined)} />
          {hadSplit ? <TextLink label="Remove the split" onPress={() => !busy && void splitExpense([], note.trim() || undefined)} /> : null}
        </View>
      </SheetBody>
    </>
  );
}

const inputStyle = sx(type.fieldText, {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  color: colors.ink,
});

const styles = {
  cta: { gap: 13, alignItems: 'center' },
  members: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingTop: 4, paddingBottom: 4 },
  member: { alignItems: 'center', width: 56 },
  addCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totals: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  rowActions: { flexDirection: 'row', gap: 18, paddingLeft: 16, paddingBottom: 12 },
  lineRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amountField: { width: 92, paddingTop: 6, paddingBottom: 6 },
  yourPart: { marginTop: 18, alignItems: 'center', gap: 4 },
} satisfies Record<string, CSSProperties>;
