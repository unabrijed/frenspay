'use client';

// /account — everything about this partner that is not live work: the stake, the tier, the settings,
// the details, the way out. Every row that changes something is its own small route; nothing here is a
// browser prompt.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useState } from 'react';

import type { MerchantProfile } from '@fpay/shared';
import { usd } from '@fpay/shared';

import { Icons } from '@fpay/ui/icons';
import { List, Row, RowMeta } from '@fpay/ui/primitives';
import { Pressable, ScrollView, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { KYB_COPY } from '@/lib/kybCopy';
import { colors, fonts, GUTTER, radii, type } from '@fpay/ui/theme';
import { cancelStakeWithdrawal } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

const clamp1: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const tierName = (t: number) => (t >= 3 ? 'Top tier' : `Tier ${t}`);
const short = (a?: string) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : 'your fpay wallet');

/** Plain English for one unmet threshold: the GAP, not the rule. */
function needLabel(n: { key: string; have: number; need: number }): string {
  switch (n.key) {
    case 'settled':
      return `${Math.max(0, Math.ceil(n.need - n.have))} more settled payouts`;
    case 'successRate':
      return `settle ${(n.need * 100).toFixed(0)}% of what you take (now ${(n.have * 100).toFixed(1)}%)`;
    case 'disputeRate':
      return `disputes under ${(n.need * 100).toFixed(1)}% (now ${(n.have * 100).toFixed(1)}%)`;
    case 'avgCompletionSecs':
      return `pay within ${Math.round(n.need)}s on average (now ${Math.round(n.have)}s)`;
    default:
      return n.key;
  }
}

/** The tier, what it carries, and the gap to the next rung. Every number is the server's own rule. */
function Tier({ m }: { m: MerchantProfile }) {
  const p = m.tierProgress;
  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <Txt style={[type.bigAmount, { fontSize: 28 }]}>{tierName(m.tier)}</Txt>
        <Txt style={type.inst}>carries {usd(m.maxFloatUsdc)} at once</Txt>
      </View>
      <View style={styles.statRow}>
        <Stat label="settled" v={`${(m.successRate * 100).toFixed(1)}%`} />
        <Stat label="liked" v={`${(m.positiveRate * 100).toFixed(0)}%`} />
        <Stat label="disputed" v={`${(m.disputeRate * 100).toFixed(1)}%`} />
      </View>
      {p && p.needs.length > 0 ? (
        <View style={styles.nextTier}>
          <Txt style={[type.rowName, { color: colors.accent }]}>{`${tierName(p.nextTier)}: ${p.leverage}× your stake`}</Txt>
          {p.needs.map((n) => (
            <Txt key={n.key} style={[type.rowTime, { marginTop: 2 }]}>
              {needLabel(n)}
            </Txt>
          ))}
        </View>
      ) : null}
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

export default function Account() {
  const router = useRouter();
  const merchant = useLpStore((s) => s.merchant);
  const load = useLpStore((s) => s.load);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  if (!merchant) {
    return (
      <Screen edges={['top']} style={styles.safe}>
        <ScrollView style={styles.scroll}>
          <Txt style={type.handle}>Account</Txt>
          <Txt style={[type.lead, { marginTop: 8 }]}>No partner account yet.</Txt>
        </ScrollView>
      </Screen>
    );
  }

  const exited = merchant.suspendReason === 'exited';
  const pending = merchant.pendingWithdrawal;
  const belowFloor = Number(merchant.bondUsdc) < Number(merchant.minBondUsdc);
  const go = (href: string) => () => router.push(href);

  return (
    <Screen edges={['top']} style={styles.safe}>
      <ScrollView style={styles.scroll}>
        <Txt style={type.handle}>Account</Txt>

        {exited ? (
          <View style={styles.notice}>
            <Txt style={type.rowName}>You’ve left fpay as a partner</Txt>
            <Txt style={[type.rowTime, { marginTop: 2 }]}>Your history stays here and you can still sign in.</Txt>
          </View>
        ) : null}

        {/* Stake: the whole trust model, and the most prominent number here. */}
        <Pressable onPress={go('/stake')} style={({ pressed }) => [styles.card, pressed ? { backgroundColor: colors.surfaceLow } : null]}>
          <Txt style={type.kvKey}>Your stake</Txt>
          <Txt style={[type.bigAmount, { fontSize: 32, marginTop: 4 }]}>{usd(merchant.bondUsdc)}</Txt>
          <Txt style={[type.inst, belowFloor ? { color: colors.danger } : null]}>
            {belowFloor ? `Below the ${usd(merchant.minBondUsdc)} minimum. Tap to add.` : `Backs ${usd(merchant.maxFloatUsdc)} of work. Tap to add.`}
          </Txt>
        </Pressable>

        {pending ? (
          <View style={styles.notice}>
            <Txt style={[type.rowName, { color: colors.accent }]}>{`${usd(pending.amountUsdc)} on its way back`}</Txt>
            <Txt style={[type.rowTime, { marginTop: 2 }]}>{`Sent by hand to ${short(pending.payoutAddress ?? merchant.payoutWallet)}, usually within a day.`}</Txt>
            <Pressable onPress={go('/account/refund-address')}>
              <Txt style={[type.rowTime, { marginTop: 8, color: colors.accent }]}>Send it somewhere else</Txt>
            </Pressable>
            {pending.exit ? null : (
              <Pressable onPress={() => void act(() => cancelStakeWithdrawal(pending.id))} disabled={busy}>
                <Txt style={[type.rowTime, { marginTop: 8, color: colors.accent }]}>Cancel and put it back</Txt>
              </Pressable>
            )}
          </View>
        ) : null}

        <Tier m={merchant} />

        <List>
          {!pending && Number(merchant.bondUsdc) > 0 && !exited ? (
            <Row onPress={go('/account/stake-back')}>
              <RowMeta>
                <Txt style={type.rowName}>Take stake back</Txt>
              </RowMeta>
              <Icons.Chevron size={16} color={colors.muted} />
            </Row>
          ) : null}
          <Row onPress={go('/account/capacity')}>
            <RowMeta>
              <Txt style={type.rowName}>Capacity</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>
                {Number(merchant.floatUsdc) > Number(merchant.maxFloatUsdc) ? `Capped at ${usd(merchant.maxFloatUsdc)}${Number(merchant.minBondUsdc) > 0 ? ' by your stake' : ''}` : 'Most you carry at once'}
              </Txt>
            </RowMeta>
            <Txt style={type.rowAmount}>{usd(Math.min(Number(merchant.floatUsdc), Number(merchant.maxFloatUsdc)))}</Txt>
          </Row>
          <Row onPress={go('/account/margin')}>
            <RowMeta>
              <Txt style={type.rowName}>Your margin</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>What you keep per payout</Txt>
            </RowMeta>
            <Txt style={type.rowAmount}>{(merchant.spreadBps / 100).toFixed(2)}%</Txt>
          </Row>
          <Row>
            <RowMeta>
              <Txt style={type.rowName}>Settles to</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }, clamp1]}>{merchant.treasuryAddress}</Txt>
            </RowMeta>
          </Row>
          <Row onPress={go('/account/phone')}>
            <RowMeta>
              <Txt style={type.rowName}>Contact number</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>{merchant.contactPhone ?? 'Add a number we can reach you on'}</Txt>
            </RowMeta>
            <Txt style={{ ...fonts.body500, fontSize: 14, color: merchant.contactPhone ? colors.muted : colors.accent }}>{merchant.contactPhone ? 'Change' : 'Add'}</Txt>
          </Row>
          <Row onPress={go('/details')}>
            <RowMeta>
              <Txt style={type.rowName}>Your details</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>{KYB_COPY[merchant.kybStatus]?.title ?? merchant.kybStatus}</Txt>
            </RowMeta>
            <Icons.Chevron size={16} color={colors.muted} />
          </Row>
          {!exited ? (
            <Row onPress={go('/account/leave')}>
              <RowMeta>
                <Txt style={type.rowName}>Leave fpay</Txt>
                <Txt style={[type.rowTime, { marginTop: 2 }]}>Your whole stake comes back. Final.</Txt>
              </RowMeta>
              <Txt style={{ ...fonts.body500, fontSize: 14, color: colors.danger }}>Leave</Txt>
            </Row>
          ) : null}
        </List>

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  safe: { backgroundColor: colors.canvas },
  scroll: { paddingTop: 14, paddingLeft: GUTTER, paddingRight: GUTTER, paddingBottom: 28 },
  card: { marginTop: 14, padding: 18, borderRadius: radii.card, backgroundColor: colors.surface },
  statRow: { flexDirection: 'row', gap: 28, marginTop: 14 },
  nextTier: { marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.hair}` },
  notice: { marginTop: 10, padding: 14, borderRadius: radii.card, backgroundColor: colors.surfaceLow },
} satisfies Record<string, CSSProperties>;
