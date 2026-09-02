'use client';

// / — the LP dashboard. Status, stake, and the queue of orders routed to this merchant.
// A different job from the rest of the app: here the user is settling OTHER people's payouts, so
// the screen leads with what they owe and what their stake is worth.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { MerchantOrder } from '@fpay/shared';

import { Icons } from '@fpay/ui/icons';
import { Btn } from '@fpay/ui/Button';
import { List, Row, RowMeta, Spacer } from '@fpay/ui/primitives';
import { Pressable, ScrollView, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { KYB_COPY } from '@/lib/kybCopy';
import { nextStep } from '@/lib/nextStep';
import { fiatRaw, usd } from '@fpay/shared';
import { colors, fonts, GUTTER, radii, type } from '@fpay/ui/theme';
import type { MerchantLedgerResponse, MerchantProfile } from '@fpay/shared';

import {
  cancelStakeWithdrawal,
  exitMerchant,
  getMerchantLedger,
  getMerchantOrders,
  requestStakeWithdrawal,
  setMerchantFloat,
  setMerchantOnline,
  setMerchantSpread,
  setContactPhone,
  setWithdrawalAddress,
} from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

const clamp1: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/** Orders still needing the merchant to act, or still inside their release window. */
const isLive = (o: MerchantOrder) => o.state === 'payment_detected';
/** Work this LP has committed to: theirs, funded, and actually taken. */
const isHeld = (o: MerchantOrder) => o.mine && isLive(o) && o.lockedAt != null;
/** Up for grabs — either routed to them and not yet taken, or someone else's that has gone open. */
const isTakeable = (o: MerchantOrder) => isLive(o) && o.lockedAt == null && o.payoutClaimedAt == null;

function OrderRow({ o, onPress }: { o: MerchantOrder; onPress: () => void }) {
  const claimed = o.payoutClaimedAt != null;
  return (
    <Row onPress={onPress}>
      <RowMeta>
        <Txt style={[type.rowName, clamp1]}>{fiatRaw(o.amountInr, o.currency)}</Txt>
        <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>
          {/* payoutDestination is absent on anything this LP hasn't taken — the server redacts it,
              so this falls through to the reference rather than leaking a payee. */}
          {o.payoutDestination ?? o.payoutName ?? o.referenceCode}
        </Txt>
      </RowMeta>
      <View style={styles.value}>
        <Txt style={{ ...fonts.body500, fontSize: 14, color: statusColor(o) }}>{statusText(o, claimed)}</Txt>
        <Icons.Chevron size={16} color={colors.muted} />
      </View>
    </Row>
  );
}

/**
 * The hero. This is why an LP opens the app when nothing is waiting: what their score is, and what
 * the next rung buys.
 *
 * Every number comes from the server's own tier rules — the same ones routing scores on — so this
 * can never promise a threshold the router disagrees with. That is the only reason it is honest to
 * put a target in front of someone.
 */
function ScoreCard({ m }: { m: MerchantProfile }) {
  const p = m.tierProgress;
  return (
    <View style={styles.scoreCard}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <Txt style={[type.bigAmount, { fontSize: 30 }]}>{tierName(m.tier)}</Txt>
        <Txt style={type.inst}>carries {usd(m.maxFloatUsdc)} at once</Txt>
      </View>

      <View style={styles.statRow}>
        <Stat label="settled" v={`${(m.successRate * 100).toFixed(1)}%`} />
        <Stat label="liked" v={`${(m.positiveRate * 100).toFixed(0)}%`} />
        <Stat label="disputed" v={`${(m.disputeRate * 100).toFixed(1)}%`} />
      </View>

      {p && p.needs.length > 0 ? (
        <View style={styles.nextTier}>
          <Txt style={[type.rowName, { color: colors.accent }]}>
            Reach {tierName(p.nextTier)} → {p.leverage}× your stake
          </Txt>
          {p.needs.map((n) => (
            <Txt key={n.key} style={[type.rowTime, { marginTop: 2 }]}>
              {needLabel(n)}
            </Txt>
          ))}
        </View>
      ) : (
        <Txt style={[type.inst, { marginTop: 10 }]}>
          {p ? 'Almost there — keep going.' : 'You’re at the top tier. Your stake works as hard as it can.'}
        </Txt>
      )}
    </View>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <View>
      <Txt style={type.rowAmount}>{v}</Txt>
      <Txt style={type.rowTime}>{label}</Txt>
    </View>
  );
}

/** Plain English for one unmet threshold. Says the GAP, not the rule — "12 more orders" is
 *  actionable in a way "settled >= 50" is not. */
function needLabel(n: { key: string; have: number; need: number }): string {
  switch (n.key) {
    case 'settled':
      return `${Math.max(0, Math.ceil(n.need - n.have))} more settled orders`;
    case 'successRate':
      return `settle ${(n.need * 100).toFixed(0)}% of what you take (you're at ${(n.have * 100).toFixed(1)}%)`;
    case 'disputeRate':
      return `keep disputes under ${(n.need * 100).toFixed(1)}% (you're at ${(n.have * 100).toFixed(1)}%)`;
    case 'avgCompletionSecs':
      return `pay within ${Math.round(n.need)}s on average (you're at ${Math.round(n.have)}s)`;
    default:
      return n.key;
  }
}

const tierName = (t: number) => (t >= 3 ? 'Top tier' : `Tier ${t}`);

function StatRow({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <Row>
      <RowMeta>
        <Txt style={type.rowName}>{k}</Txt>
        {sub ? <Txt style={[type.rowTime, { marginTop: 2 }]}>{sub}</Txt> : null}
      </RowMeta>
      <Txt style={type.rowAmount}>{v}</Txt>
    </Row>
  );
}

function statusText(o: MerchantOrder, claimed: boolean): string {
  if (o.state === 'completed') return 'Settled';
  if (o.state === 'merchant_confirms' || o.state === 'funds_released') return 'Releasing';
  if (o.resolution === 'under_review') return 'Disputed';
  if (claimed) return 'Releasing';
  // Untaken. "Take it" for anything still up for grabs; the routed LP sees the same word during
  // their head start, which is honest — holding it first isn't holding it.
  return o.lockedAt == null ? 'Take it' : 'Pay now';
}
function statusColor(o: MerchantOrder): string {
  if (o.resolution === 'under_review') return colors.danger;
  if (o.state === 'completed') return colors.secondary;
  return o.payoutClaimedAt ? colors.muted : colors.accent;
}

export default function MerchantHome() {
  const router = useRouter();
  const merchant = useLpStore((s) => s.merchant);
  const load = useLpStore((s) => s.load);
  const [orders, setOrders] = useState<MerchantOrder[] | null>(null);
  const [ledger, setLedger] = useState<MerchantLedgerResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setOrders(await getMerchantOrders());
      setErr(null);
    } catch (e) {
      setErr(friendlyError(e));
    }
    // Separate and swallowed: the ledger is context, and a failure to load it must never blank the
    // queue, which is the part with money waiting on it.
    try {
      setLedger(await getMerchantLedger());
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * Run a settings write, then re-read the profile. `load()` is the refresh, not a local setState:
   * MerchantProfile rides on /me, and several of these fields are recomputed server-side (capacity
   * is capped against the stake, a withdrawal moves the bond) — echoing the request back would show
   * the LP what they asked for rather than what they got.
   */
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        setErr(null);
        await load();
      } catch (e) {
        setErr(friendlyError(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  const toggleOnline = () => act(() => setMerchantOnline(merchant?.status !== 'online'));

  // window.prompt, deliberately: these are rare, numeric, single-field edits by the one person who
  // runs this account. A bottom sheet each would be three new SheetIds and three new components for
  // three number entries. Revisit if LPs edit these often enough to notice.
  const editCapacity = () => {
    const raw = window.prompt('Most you can have in flight at once, in dollars', String(Number(merchant?.floatUsdc ?? 0)));
    if (raw == null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return setErr('Enter a number, like 5000.');
    return act(() => setMerchantFloat(n));
  };

  const editSpread = () => {
    // The ceiling is the tier's, so the prompt names the real bound — a refused edit should read
    // as "your tier", not as a bug.
    const capPct = ((merchant?.maxSpreadBps ?? 100) / 100).toFixed(2);
    const raw = window.prompt(`Your margin, as a percent (0.10 to ${capPct} at your tier)`, ((merchant?.spreadBps ?? 50) / 100).toFixed(2));
    if (raw == null) return;
    const pct = Number(raw);
    if (!Number.isFinite(pct)) return setErr('Enter a percent, like 0.50.');
    return act(() => setMerchantSpread(Math.round(pct * 100)));
  };

  const editContactPhone = () => {
    const current = merchant?.contactPhone ?? '+91 ';
    const raw = window.prompt('The number we call if a payout goes wrong', current);
    if (raw == null) return;
    const phone = raw.replace(/\s/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) return setErr('Include the country code, like +919876543210.');
    return act(() => setContactPhone(phone));
  };

  // The terms at the moment of commitment, not on a page nobody reads: where it goes, how, how soon,
  // and the one thing that can refuse it. Where it goes is THEIRS to say (docs/20): any Solana wallet
  // they hold, prefilled with their fpay wallet — blank or unchanged means that one.
  const short = (a?: string) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : 'your fpay wallet');
  const askPayoutAddress = (current?: string): string | null | undefined => {
    const raw = window.prompt(
      'Which wallet should we send it to? A Solana address that holds USDC — your fpay wallet is filled in.',
      current ?? merchant?.payoutWallet ?? '',
    );
    if (raw == null) return undefined; // cancelled
    const a = raw.trim();
    return a && a !== merchant?.payoutWallet ? a : null;
  };
  const withdraw = () => {
    const raw = window.prompt(
      `How much of your stake to take back, in dollars?\n\nWe send it by hand to a wallet you choose next, usually within a day. It can't leave while a payout you handled is less than ${merchant?.clawWindowHours ?? 72} hours old — that's how long it can still be disputed.`,
    );
    if (raw == null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return setErr('Enter an amount, like 50.');
    const to = askPayoutAddress();
    if (to === undefined) return;
    return act(() => requestStakeWithdrawal(n, to));
  };

  // Final, and said so. The server refuses it for the same reasons as a withdrawal.
  const leave = () => {
    if (!merchant) return;
    const ok = window.confirm(
      `Leave fpay as a partner?\n\nYour whole stake (${usd(merchant.bondUsdc)}) is sent back by hand to a wallet you choose next, usually within a day. You keep your history and can still sign in, but you won't be offered orders again and this can't be undone from here.`,
    );
    if (!ok) return;
    const to = askPayoutAddress();
    if (to === undefined) return;
    return act(() => exitMerchant(to));
  };

  // An exit cannot be cancelled, so the address on it must still be changeable while it is open.
  const changeAddress = () => {
    const w = merchant?.pendingWithdrawal;
    if (!w) return;
    const to = askPayoutAddress(w.payoutAddress);
    if (to === undefined) return;
    return act(() => setWithdrawalAddress(w.id, to));
  };

  // Same polling shape as the payer's order tracker — new work arrives without a manual refresh.
  useEffect(() => {
    if (!merchant) return undefined;
    void reload();
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [merchant, reload]);

  if (!merchant) {
    return (
      <Screen edges={['top']} style={styles.safe}>
        <ScrollView style={styles.scroll}>
          <Txt style={type.handle}>Become a partner</Txt>
          <Txt style={[type.lead, { marginTop: 10 }]}>
            Partners settle other people’s payouts and earn a spread. You put up a stake up front.
            If you don’t pay someone, it covers them.
          </Txt>
          <Spacer />
          <Btn label="Apply" variant="ink" onPress={() => router.push('/apply')} />
        </ScrollView>
      </Screen>
    );
  }

  const all = orders ?? [];
  const held = all.filter(isHeld);
  const takeable = all.filter(isTakeable);
  const done = all.filter((o) => o.mine && !isLive(o));
  // Number() on both sides: a bare `<` between two decimal STRINGS compares them lexically, so
  // "900.000000" would read as above a "2000.000000" floor and the warning would never show.
  const belowFloor = Number(merchant.bondUsdc) < Number(merchant.minBondUsdc);
  // Off is always allowed; on needs the same two things the server checks — the business approved
  // and the stake at the floor. Gating on one of them left a tap that could only fail.
  const canToggle =
    merchant.status === 'online' || (merchant.status === 'offline' && merchant.kybStatus === 'approved' && !belowFloor);
  const step = nextStep(merchant);

  return (
    <Screen edges={['top']} style={styles.safe}>
      <ScrollView style={styles.scroll}>
        <Txt style={type.handle}>{merchant.name}</Txt>
        <Txt style={[type.profileSub, { marginTop: 2 }]}>{statusLabel(merchant.status)}</Txt>

        {/* The one thing to do next. A fresh partner lands here offline, unverified and unstaked —
            three blockers between them and an order — and used to be shown a status line and a
            tap-only card. This names the first blocker and makes it the button. */}
        {step ? (
          <View style={[styles.notice, { marginTop: 14 }]}>
            <Txt style={type.rowName}>{step.title}</Txt>
            <Txt style={[type.rowTime, { marginTop: 2 }]}>{step.body}</Txt>
            {step.cta ? (
              <Btn
                label={step.cta}
                variant="ink"
                height={44}
                disabled={busy}
                style={{ marginTop: 12 }}
                onPress={() => (step.href ? router.push(step.href) : void toggleOnline())}
              />
            ) : null}
          </View>
        ) : null}

        {/* The reason to open this app when nothing is waiting. */}
        <ScoreCard m={merchant} />

        {/* The stake is the whole trust model — the most prominent number on the screen. */}
        <Pressable
          onPress={() => router.push('/stake')}
          style={({ pressed }) => [styles.stakeCard, pressed ? { backgroundColor: colors.surfaceLow } : null]}
        >
          <Txt style={type.kvKey}>Your stake</Txt>
          <Txt style={[type.bigAmount, { fontSize: 34, marginTop: 4 }]}>{usd(merchant.bondUsdc)}</Txt>
          <Txt style={[type.inst, belowFloor ? { color: colors.danger } : null]}>
            {belowFloor
              ? `Below the ${usd(merchant.minBondUsdc)} minimum. No orders until you top up.`
              : `Minimum ${usd(merchant.minBondUsdc)} · tap to add · backs ${usd(merchant.maxFloatUsdc)} of work`}
          </Txt>
        </Pressable>
        {!merchant.pendingWithdrawal && Number(merchant.bondUsdc) > 0 && merchant.suspendReason !== 'exited' ? (
          <Pressable onPress={() => void withdraw()}>
            <Txt style={[type.rowTime, { marginTop: 2, marginBottom: 8, color: colors.accent }]}>
              Take some back
            </Txt>
          </Pressable>
        ) : null}

        {merchant.pendingWithdrawal ? (
          <View style={styles.notice}>
            <Txt style={[type.rowName, { color: colors.accent }]}>
              {usd(merchant.pendingWithdrawal.amountUsdc)} on its way back
            </Txt>
            <Txt style={[type.rowTime, { marginTop: 2 }]}>
              {`Already taken off your stake. We send it by hand to ${short(merchant.pendingWithdrawal.payoutAddress ?? merchant.payoutWallet)} — usually within a day.`}
            </Txt>
            <Pressable onPress={() => void changeAddress()}>
              <Txt style={[type.rowTime, { marginTop: 8, color: colors.accent }]}>Send it somewhere else</Txt>
            </Pressable>
            {/* An exit is final; only an ordinary withdrawal can be put back. */}
            {merchant.pendingWithdrawal.exit ? null : (
              <Pressable onPress={() => void act(() => cancelStakeWithdrawal(merchant.pendingWithdrawal!.id))}>
                <Txt style={[type.rowTime, { marginTop: 8, color: colors.accent }]}>Cancel and put it back</Txt>
              </Pressable>
            )}
          </View>
        ) : null}
        {merchant.suspendReason === 'exited' ? (
          <View style={styles.notice}>
            <Txt style={type.rowName}>You’ve left fpay as a partner</Txt>
            <Txt style={[type.rowTime, { marginTop: 2 }]}>
              Your history stays here and you can still sign in. You won’t be offered orders again.
            </Txt>
          </View>
        ) : null}

        <List>
          {/* Availability. Until now `merchants.status` was admin-only and the documented workaround
              was setting capacity to zero — which says "I have no money", not "I'm asleep", and
              routing reads those very differently. */}
          <Row onPress={canToggle ? () => void toggleOnline() : undefined}>
            <RowMeta>
              <Txt style={type.rowName}>Taking orders</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>
                {merchant.status === 'suspended'
                  ? merchant.suspendReason === 'exited'
                    ? 'You’ve left — no more orders'
                    : merchant.suspendReason === 'bond'
                      ? 'Below the stake minimum — top up to come back'
                      : 'Suspended — contact support'
                  : merchant.status === 'online'
                    ? 'You’ll be offered new orders'
                    : merchant.kybStatus !== 'approved'
                      ? 'Once your details are approved'
                      : belowFloor
                        ? `Once your stake is at least ${usd(merchant.minBondUsdc)}`
                        : 'Nothing will reach you'}
              </Txt>
            </RowMeta>
            <Txt style={{ ...fonts.body500, fontSize: 14, color: onlineColor(merchant.status) }}>
              {merchant.status === 'online' ? 'On' : 'Off'}
            </Txt>
          </Row>
          <Row onPress={() => void editCapacity()}>
            <RowMeta>
              <Txt style={type.rowName}>Capacity</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>
                {/* Number() on both sides — these are decimal strings, and a lexical compare would
                    read "900.000000" as larger than "15000.000000". */}
                {Number(merchant.floatUsdc) > Number(merchant.maxFloatUsdc)
                  ? `Capped at ${usd(merchant.maxFloatUsdc)} by your stake`
                  : 'Most you can have in flight at once'}
              </Txt>
            </RowMeta>
            <Txt style={type.rowAmount}>
              {usd(Math.min(Number(merchant.floatUsdc), Number(merchant.maxFloatUsdc)))}
            </Txt>
          </Row>
          <Row onPress={() => void editSpread()}>
            <RowMeta>
              <Txt style={type.rowName}>Your margin</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>What you keep per payout. Lower wins more work.</Txt>
            </RowMeta>
            <Txt style={type.rowAmount}>{(merchant.spreadBps / 100).toFixed(2)}%</Txt>
          </Row>
          <Row>
            <RowMeta>
              <Txt style={type.rowName}>Settles to</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>{merchant.treasuryAddress}</Txt>
            </RowMeta>
          </Row>
          {/* Everyone who onboarded before this existed has no number on file, and apply refuses an
              existing provider — so this row is their only way to add one. Nudged, never blocked. */}
          <Row onPress={editContactPhone}>
            <RowMeta>
              <Txt style={type.rowName}>Contact number</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>
                {merchant.contactPhone ?? 'Add a number we can reach you on'}
              </Txt>
            </RowMeta>
            <Txt style={{ ...fonts.body500, fontSize: 14, color: merchant.contactPhone ? colors.muted : colors.accent }}>
              {merchant.contactPhone ? 'Change' : 'Add'}
            </Txt>
          </Row>
          {/* The business check's history and the reviewer's note live on /business; once the
              next-step card has moved past it, this row is the only way back there. */}
          <Row onPress={() => router.push('/business')}>
            <RowMeta>
              <Txt style={type.rowName}>Your details</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>{KYB_COPY[merchant.kybStatus]?.title ?? merchant.kybStatus}</Txt>
            </RowMeta>
            <Icons.Chevron size={16} color={colors.muted} />
          </Row>
          {/* The way out. A flag, never a delete: the ledger and the history stay (docs/15). */}
          {merchant.suspendReason !== 'exited' ? (
            <Row onPress={() => void leave()}>
              <RowMeta>
                <Txt style={type.rowName}>Leave fpay</Txt>
                <Txt style={[type.rowTime, { marginTop: 2 }]}>Your whole stake comes back. Final.</Txt>
              </RowMeta>
              <Txt style={{ ...fonts.body500, fontSize: 14, color: colors.danger }}>Leave</Txt>
            </Row>
          ) : null}
        </List>

        {ledger ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>Last {ledger.earnings.windowDays} days</Txt>
            <List>
              <StatRow k="Settled to you" v={usd(ledger.earnings.usdcIn)} sub={`${ledger.earnings.settled} orders`} />
              {/* Both sides, no "profit": what it cost you to send that fiat is between you and
                  your bank, and a margin computed from our rate would disagree with your statement. */}
              <StatRow k="You paid out" v={fiatRaw(ledger.earnings.fiatOut, ledger.earnings.currency)} />
            </List>
          </>
        ) : null}

        {ledger?.disputes.length ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>Disputes ({ledger.disputes.length})</Txt>
            <List>
              {ledger.disputes.map((d) => (
                <Row key={d.id} onPress={() => router.push(`/orders/${d.orderId}`)}>
                  <RowMeta>
                    <Txt style={type.rowName}>{d.referenceCode}</Txt>
                    <Txt style={[type.rowTime, { marginTop: 2 }]}>
                      {d.status === 'open'
                        ? 'The payer says this never arrived. We’re looking at it.'
                        : d.resolution === 'upheld'
                          ? 'Decided against you — your stake covered the payer.'
                          : 'Decided in your favour.'}
                    </Txt>
                  </RowMeta>
                  <Txt
                    style={{
                      ...fonts.body500,
                      fontSize: 14,
                      color: d.status === 'open' ? colors.accent : d.resolution === 'upheld' ? colors.danger : colors.secondary,
                    }}
                  >
                    {d.status === 'open' ? 'Open' : d.resolution === 'upheld' ? 'Lost' : 'Won'}
                  </Txt>
                </Row>
              ))}
            </List>
          </>
        ) : null}

        {/* Reputation — the real smoothed numbers routing scores them on, no invented composite. */}
        <Txt style={[type.kvKey, styles.section]}>Reputation</Txt>
        <List>
          <StatRow k="Success rate" v={`${(merchant.successRate * 100).toFixed(1)}%`} />
          <StatRow k="Positive feedback" v={`${(merchant.positiveRate * 100).toFixed(0)}%`} sub="One-tap ratings from people you paid" />
          <StatRow k="Disputes" v={`${(merchant.disputeRate * 100).toFixed(1)}%`} />
          <StatRow k="Completed" v={String((orders ?? []).filter((o) => o.state === 'completed').length)} />
        </List>

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}

        {/* Two queues, and the split is the point. "To pay" is what this LP has committed to and
            owes someone. "Up for grabs" is work anyone eligible can still take — first come.
            These sit ABOVE the score only when there is something in them: a five-minute lock is
            time-critical and a score is not, but making someone scroll past their stats every time
            they open the app to check on nothing is the other failure. */}
        <Txt style={[type.kvKey, styles.section]}>To pay ({held.length})</Txt>
        {orders === null ? (
          <Txt style={type.inst}>Loading…</Txt>
        ) : held.length === 0 ? (
          <Txt style={type.inst}>Nothing on you right now.</Txt>
        ) : (
          <List>
            {held.map((o) => (
              <OrderRow key={o.id} o={o} onPress={() => router.push(`/orders/${o.id}`)} />
            ))}
          </List>
        )}

        <Txt style={[type.kvKey, styles.section]}>Up for grabs ({takeable.length})</Txt>
        {orders === null ? null : takeable.length === 0 ? (
          <Txt style={type.inst}>
            {merchant.status === 'online'
              ? 'Nothing waiting. We’ll ping you the moment something lands.'
              : 'You’re offline, so nothing is being offered to you.'}
          </Txt>
        ) : (
          <List>
            {takeable.map((o) => (
              <OrderRow key={o.id} o={o} onPress={() => router.push(`/orders/${o.id}`)} />
            ))}
          </List>
        )}

        {done.length > 0 ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>Recent</Txt>
            <List>
              {done.slice(0, 10).map((o) => (
                <OrderRow key={o.id} o={o} onPress={() => router.push(`/orders/${o.id}`)} />
              ))}
            </List>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const statusLabel = (s: string) =>
  s === 'online' ? 'Online, receiving orders' : s === 'suspended' ? 'Suspended' : 'Offline';
const onlineColor = (s: string) =>
  s === 'online' ? colors.secondary : s === 'suspended' ? colors.danger : colors.muted;
const styles = {
  safe: { backgroundColor: colors.canvas },
  scroll: {
    paddingTop: 14,
    paddingLeft: GUTTER,
    paddingRight: GUTTER,
    paddingBottom: 28,
  },
  scoreCard: { marginTop: 16, padding: 18, borderRadius: radii.card, backgroundColor: colors.surface },
  statRow: { flexDirection: 'row', gap: 28, marginTop: 14 },
  nextTier: { marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.hair}` },
  stakeCard: { marginTop: 16, marginBottom: 6, padding: 18, borderRadius: radii.card, backgroundColor: colors.surface },
  notice: { marginTop: 6, marginBottom: 10, padding: 14, borderRadius: radii.card, backgroundColor: colors.surfaceLow },
  value: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  section: { marginTop: 22, marginBottom: 8 },
} satisfies Record<string, CSSProperties>;
