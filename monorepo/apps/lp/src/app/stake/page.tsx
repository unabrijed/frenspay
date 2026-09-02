'use client';

// /stake — put real money behind the promise. The stake is what makes a stranger's payout safe to
// route to this partner: an upheld dispute takes from it, and falling under the minimum takes them
// out of routing entirely.
//
// How it is paid (docs/20): the partner sends USDC to fpay's stake address from wherever their USDC
// is — an exchange, another wallet — and pastes the transaction ID here. The server reads what that
// transaction moved off the chain, a person attributes it, and the bond lands only after the
// confirmer's own chain check. Nothing is typed but the ID, so nothing can be mistyped into a burned
// deposit. The older door — stake straight from the fpay wallet — stays, shown only when that wallet
// holds anything; it is the one path whose attribution is automatic.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { MerchantStakeClaimsResponse, StakeClaim } from '@fpay/shared';

import { BackButton } from '@fpay/ui/BackButton';
import { Btn } from '@fpay/ui/Button';
import { Keypad } from '@fpay/ui/Keypad';
import { List, Row, RowMeta, SearchBar, Spacer } from '@fpay/ui/primitives';
import { Pressable, ScrollView, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { usd } from '@fpay/shared';
import { colors, fonts, GUTTER, radii, type } from '@fpay/ui/theme';
import { depositStake, getStakeClaims, submitStakeClaim } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

/** Still moving: the server has not decided, or has and the chain check has not finished. */
const isPending = (c: StakeClaim) =>
  c.status === 'submitted' || (c.status === 'accepted' && c.transferStatus !== 'confirmed' && c.transferStatus !== 'failed');

/** One line per claim, in the partner's words. Once accepted, the transfer's status is the truth. */
function claimLabel(c: StakeClaim): { text: string; color: string } {
  switch (c.status) {
    case 'submitted':
      return { text: 'Being checked', color: colors.muted };
    case 'accepted':
      if (c.transferStatus === 'confirmed') return { text: 'Added to your stake', color: colors.accent };
      if (c.transferStatus === 'failed') return { text: 'Didn’t check out — contact us', color: colors.danger };
      return { text: 'Confirming', color: colors.muted };
    case 'rejected':
      return { text: c.note ? `Not accepted: ${c.note}` : 'Not accepted', color: colors.danger };
    case 'duplicate':
      return { text: 'Already used', color: colors.danger };
  }
}

const shortSig = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
const POLL_MS = 10_000;

export default function MerchantStake() {
  const router = useRouter();
  const merchant = useLpStore((s) => s.merchant);
  const balanceUSD = useLpStore((s) => s.balanceUSD);
  const load = useLpStore((s) => s.load);
  const notify = useLpStore((s) => s.notify);

  const [claims, setClaims] = useState<MerchantStakeClaimsResponse | null>(null);
  const [signature, setSignature] = useState('');
  const [copied, setCopied] = useState(false);
  const [fromWallet, setFromWallet] = useState(false);
  const [d, setD] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setClaims(await getStakeClaims());
    } catch {
      /* keep the last list — the address does not change and a stale row is better than none */
    }
  }, []);

  // Redirect in an effect, not during render — the client router touches `location`, which
  // doesn't exist while this page is being statically prerendered.
  useEffect(() => {
    if (!merchant) router.replace('/');
    else void refresh();
  }, [merchant, router, refresh]);

  // While anything is still being checked, ask again — and refresh the profile too, so the bond shows
  // up here without a reload and the dashboard is already right when they go back to it.
  const somethingPending = claims?.claims.some(isPending) ?? false;
  useEffect(() => {
    if (!somethingPending) return undefined;
    const t = setInterval(() => {
      void refresh();
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [somethingPending, refresh, load]);

  if (!merchant) return null;

  const address = claims?.address ?? null;
  const copy = () => {
    if (!address) return;
    void navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const submitClaim = async () => {
    const sig = signature.trim();
    if (!sig || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await submitStakeClaim(sig);
      setSignature('');
      notify('Got it. We’re checking it on the network.', 'success');
      await refresh();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const amount = parseInt(d || '0', 10);
  const press = (k: string) => {
    if (k === '⌫') setD((s) => s.slice(0, -1));
    else if (d.length < 6) setD((s) => (s === '0' ? '' : s) + k);
  };
  const submitFromWallet = async () => {
    setBusy(true);
    setErr(null);
    try {
      const how = await depositStake(amount);
      setD('');
      // The bond credits only when the transfer confirms on-chain, so don't claim it's live yet.
      notify(how === 'sent' ? 'Stake sent. It’ll show up once it confirms.' : 'Sent — and submitted for checking. It’ll show below.', 'success');
      await Promise.all([load(), refresh()]);
      if (how === 'sent') router.push('/');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  // Number() at the point of use: these are decimal strings on the wire, and `-` / `<` on a string
  // is either a coercion or a LEXICAL compare ("900.000000" < "2000.000000" is false).
  const shortfall = Math.max(0, Number(merchant.minBondUsdc) - Number(merchant.bondUsdc));

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push('/')} />
      </View>
      <ScrollView style={styles.scroll}>
        <View style={styles.current}>
          <Txt style={type.kvKey}>Staked now</Txt>
          <Txt style={[type.rowAmount, { fontSize: 20, marginTop: 2 }]}>{usd(merchant.bondUsdc)}</Txt>
          <Txt style={[type.inst, shortfall > 0 ? { color: colors.danger } : null]}>
            {shortfall > 0
              ? `Add ${usd(shortfall)} to reach the ${usd(merchant.minBondUsdc)} minimum.`
              : `Minimum ${usd(merchant.minBondUsdc)}, you’re covered.`}
          </Txt>
        </View>

        <Txt style={[type.kvKey, styles.section]}>Add to your stake</Txt>
        {claims && !address ? (
          <Txt style={[type.lead, { marginBottom: 12 }]}>Staking isn’t available yet. Try again shortly.</Txt>
        ) : address ? (
          <>
            {/* 1. Pay the address. Tap to copy — no QR, a partner is pasting this into an exchange. */}
            <Pressable onPress={copy} style={({ pressed }) => [styles.addressCard, pressed ? { backgroundColor: colors.surfaceLow } : null]}>
              <Txt style={type.kvKey}>{copied ? 'Copied' : 'fpay’s stake address · tap to copy'}</Txt>
              <Txt style={[{ ...fonts.mono400, fontSize: 15, color: colors.ink }, styles.address]}>{address}</Txt>
              <Txt style={type.inst}>{`Send USDC on Solana here, from any wallet or exchange. The minimum is ${usd(merchant.minBondUsdc)}.`}</Txt>
            </Pressable>

            {/* 2. Tell us which transaction. The server reads the amount off the chain — nothing to type. */}
            <View style={{ marginTop: 12 }}>
              <SearchBar placeholder="Paste the transaction ID" value={signature} onChangeText={setSignature} />
            </View>
            {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 10 }]}>{err}</Txt> : null}
            <View style={{ marginTop: 10 }}>
              <Btn label={busy ? 'Sending…' : 'Submit for checking'} variant="ink" disabled={busy || !signature.trim()} onPress={() => void submitClaim()} />
            </View>
            <Txt style={[type.inst, { marginTop: 10 }]}>
              We check it on the network, and a person confirms it — usually within a day. If your wallet has a note or memo field,
              put your @handle in it; it speeds up matching.
            </Txt>
          </>
        ) : null}

        {claims && claims.claims.length > 0 ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>Submitted</Txt>
            <List>
              {claims.claims.map((c) => {
                const label = claimLabel(c);
                return (
                  <Row key={c.id}>
                    <RowMeta>
                      <Txt style={type.rowName}>{usd(c.amountUsdc)}</Txt>
                      <Txt style={[type.rowTime, { marginTop: 2 }]}>
                        {`${shortSig(c.signature)} · ${new Date(c.createdAt).toLocaleDateString()}`}
                      </Txt>
                    </RowMeta>
                    <Txt style={[{ ...fonts.body500, fontSize: 13, color: label.color }, styles.status]}>{label.text}</Txt>
                  </Row>
                );
              })}
            </List>
          </>
        ) : null}

        {/* The second door: their fpay wallet already holds USDC (funded through the payer app — same
            account, same wallet). Attribution is automatic here, so no one has to look at it. */}
        {balanceUSD > 0 && address ? (
          <Pressable onPress={() => setFromWallet((v) => !v)}>
            <Txt style={[type.rowTime, { marginTop: 18, color: colors.accent }]}>
              {fromWallet ? 'Hide' : `Or stake from your fpay balance (${usd(balanceUSD)})`}
            </Txt>
          </Pressable>
        ) : null}
        {fromWallet && balanceUSD > 0 ? (
          <>
            <View style={styles.amountbig}>
              <Txt style={[type.bigAmount, { color: colors.ink }]}>{usd(amount)}</Txt>
              <Txt style={type.conv}>{usd(balanceUSD)} available</Txt>
            </View>
            <Keypad onPress={press} />
            <Btn
              label={busy ? 'Confirming…' : 'Add to stake'}
              variant="ink"
              disabled={busy || amount <= 0 || amount > balanceUSD}
              onPress={() => void submitFromWallet()}
            />
          </>
        ) : null}

        <Spacer />
        {/* The penalty rule and the claw window, before the first deposit — not on a page nobody
            reads. Both numbers come from the server (docs/15). */}
        <Txt style={[type.inst, { marginTop: 18, marginBottom: 12 }]}>
          {`Held while you’re a partner. If a payment you handled is upheld against you, we take that payment’s amount from your stake — never more than your stake. It can’t leave for ${merchant.clawWindowHours} hours after a payout, while that payout can still be disputed. Ask for it back any time after that; we send it by hand to your fpay wallet, or any Solana wallet you give us when you ask, usually within a day.`}
        </Txt>
      </ScrollView>
    </Screen>
  );
}

const styles = {
  safe: { backgroundColor: colors.canvas },
  head: { paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 6, paddingBottom: 2 },
  scroll: {
    paddingLeft: GUTTER,
    paddingRight: GUTTER,
    paddingBottom: 28,
  },
  current: { padding: 16, borderRadius: radii.card, backgroundColor: colors.surface, marginBottom: 10 },
  section: { marginTop: 12, marginBottom: 8 },
  addressCard: { padding: 16, borderRadius: radii.card, backgroundColor: colors.surface, gap: 6 },
  address: { wordBreak: 'break-all', lineHeight: '22px' },
  status: { textAlign: 'right', maxWidth: '55%' },
  amountbig: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 18, paddingBottom: 18 },
} satisfies Record<string, CSSProperties>;
