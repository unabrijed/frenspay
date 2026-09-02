'use client';

// /activity — what happened: payouts settled, disputes, stake in and out. Read-only; live work is on
// Home. Everything here is already fetched for other screens or one call away — no new endpoint.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { MerchantLedgerResponse, MerchantOrder, StakeClaim } from '@fpay/shared';
import { fiatRaw, usd } from '@fpay/shared';

import { Chip, Chips, Empty, List, Row, RowMeta } from '@fpay/ui/primitives';
import { ScrollView, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { isDone, OrderRow } from '@/components/OrderRow';
import { claimLabel, shortSig } from '@/lib/claims';
import { colors, fonts, GUTTER, type } from '@fpay/ui/theme';
import { getMerchantLedger, getMerchantOrders, getStakeClaims } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

type Tab = 'payouts' | 'disputes' | 'stake';
const TABS: { key: Tab; label: string }[] = [
  { key: 'payouts', label: 'Payouts' },
  { key: 'disputes', label: 'Disputes' },
  { key: 'stake', label: 'Stake' },
];

export default function Activity() {
  const router = useRouter();
  const merchant = useLpStore((s) => s.merchant);
  const [tab, setTab] = useState<Tab>('payouts');
  const [orders, setOrders] = useState<MerchantOrder[] | null>(null);
  const [ledger, setLedger] = useState<MerchantLedgerResponse | null>(null);
  const [claims, setClaims] = useState<StakeClaim[] | null>(null);

  const reload = useCallback(async () => {
    // Each source fails on its own; a stale list beats a blank screen.
    try {
      setOrders(await getMerchantOrders());
    } catch {
      /* keep */
    }
    try {
      setLedger(await getMerchantLedger());
    } catch {
      /* keep */
    }
    try {
      setClaims((await getStakeClaims()).claims);
    } catch {
      /* keep */
    }
  }, []);

  useEffect(() => {
    if (!merchant) return undefined;
    void reload();
    const t = setInterval(() => void reload(), 10_000);
    return () => clearInterval(t);
  }, [merchant, reload]);

  if (!merchant) {
    return (
      <Screen edges={['top']} style={styles.safe}>
        <ScrollView style={styles.scroll}>
          <Empty label="Nothing here until you are a partner." />
        </ScrollView>
      </Screen>
    );
  }

  const done = (orders ?? []).filter(isDone);
  const disputes = ledger?.disputes ?? [];
  const pending = merchant.pendingWithdrawal;

  return (
    <Screen edges={['top']} style={styles.safe}>
      <ScrollView style={styles.scroll}>
        <Txt style={type.handle}>Activity</Txt>
        <View style={{ marginTop: 12 }}>
          <Chips>
            {TABS.map((t) => (
              <Chip key={t.key} label={t.label} on={tab === t.key} onPress={() => setTab(t.key)} />
            ))}
          </Chips>
        </View>

        {tab === 'payouts' ? (
          <>
            {ledger ? (
              <Txt style={[type.inst, { marginTop: 14 }]}>
                {`Last ${ledger.earnings.windowDays} days: ${ledger.earnings.settled} payouts, ${usd(ledger.earnings.usdcIn)} to you, ${fiatRaw(ledger.earnings.fiatOut, ledger.earnings.currency)} paid out.`}
              </Txt>
            ) : null}
            {orders === null ? (
              <Txt style={[type.inst, { marginTop: 14 }]}>Loading…</Txt>
            ) : done.length === 0 ? (
              <Empty label="No payouts yet." />
            ) : (
              <List>
                {done.map((o) => (
                  <OrderRow key={o.id} o={o} onPress={() => router.push(`/orders/${o.id}`)} />
                ))}
              </List>
            )}
          </>
        ) : null}

        {tab === 'disputes' ? (
          disputes.length === 0 ? (
            <Empty label="No disputes." />
          ) : (
            <List>
              {disputes.map((d) => (
                <Row key={d.id} onPress={() => router.push(`/orders/${d.orderId}`)}>
                  <RowMeta>
                    <Txt style={type.rowName}>{d.referenceCode}</Txt>
                    <Txt style={[type.rowTime, { marginTop: 2 }]}>
                      {d.status === 'open'
                        ? 'The payer says this never arrived. We’re looking at it.'
                        : d.resolution === 'upheld'
                          ? 'Decided against you. Your stake covered the payer.'
                          : 'Decided in your favour.'}
                    </Txt>
                  </RowMeta>
                  <Txt style={{ ...fonts.body500, fontSize: 14, color: d.status === 'open' ? colors.accent : d.resolution === 'upheld' ? colors.danger : colors.secondary }}>
                    {d.status === 'open' ? 'Open' : d.resolution === 'upheld' ? 'Lost' : 'Won'}
                  </Txt>
                </Row>
              ))}
            </List>
          )
        ) : null}

        {tab === 'stake' ? (
          <>
            <Txt style={[type.inst, { marginTop: 14 }]}>{`Staked now: ${usd(merchant.bondUsdc)}`}</Txt>
            {pending ? (
              <List>
                <Row onPress={() => router.push('/account')}>
                  <RowMeta>
                    <Txt style={type.rowName}>{`${usd(pending.amountUsdc)} on its way back`}</Txt>
                    <Txt style={[type.rowTime, { marginTop: 2 }]}>{pending.exit ? 'Leaving. Sent by hand, usually within a day.' : 'Sent by hand, usually within a day.'}</Txt>
                  </RowMeta>
                </Row>
              </List>
            ) : null}
            {claims === null ? null : claims.length === 0 && !pending ? (
              <Empty label="No stake movements yet." />
            ) : (
              <List>
                {claims.map((c) => {
                  const label = claimLabel(c);
                  return (
                    <Row key={c.id}>
                      <RowMeta>
                        <Txt style={type.rowName}>{usd(c.amountUsdc)}</Txt>
                        <Txt style={[type.rowTime, { marginTop: 2 }]}>{`${shortSig(c.signature)} · ${new Date(c.createdAt).toLocaleDateString()}`}</Txt>
                      </RowMeta>
                      <Txt style={{ ...fonts.body500, fontSize: 13, color: label.color, textAlign: 'right', maxWidth: '55%' }}>{label.text}</Txt>
                    </Row>
                  );
                })}
              </List>
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  safe: { backgroundColor: colors.canvas },
  scroll: { paddingTop: 14, paddingLeft: GUTTER, paddingRight: GUTTER, paddingBottom: 28 },
} satisfies Record<string, CSSProperties>;
