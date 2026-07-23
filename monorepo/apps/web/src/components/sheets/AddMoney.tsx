'use client';

// AddMoney.tsx — short bottom sheet: amount chips + field, plus a USDC deposit row.
import { useState } from 'react';

import { Icons } from '@/components/icons';
import { Btn, TextLink } from '@/components/ui/Button';
import { Chip, Chips, Eyebrow, Field, Grab, List, Row, RowIcon, RowMeta, SheetBody, SheetHeader } from '@/components/ui/primitives';
import { haptic, Pressable, sx, View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { colors, fonts, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

const CHIPS = [50, 100, 250];

// On-ramp is an allowed chain-surface context: the deposit address works on several networks
// and the user must know which ones. Dollars-only copy everywhere else.
const DEPOSIT_NETWORKS: Array<{ id: string; name: string }> = [
  { id: 'base', name: 'Base' },
  { id: 'arbitrum', name: 'Arbitrum' },
  { id: 'ethereum', name: 'Ethereum' },
];

function FromAnotherWallet() {
  const evmAddress = usePayStore((s) => s.evmDepositAddress);
  const balances = usePayStore((s) => s.depositBalances);
  const depositBusy = usePayStore((s) => s.depositBusy);
  const checkDeposits = usePayStore((s) => s.checkDeposits);
  const doMoveToBalance = usePayStore((s) => s.doMoveToBalance);
  const error = usePayStore((s) => s.error);
  const [copied, setCopied] = useState(false);
  if (!evmAddress) return null; // no smart wallet yet (dev mode / first login still provisioning)

  const copy = async () => {
    haptic();
    await navigator.clipboard.writeText(evmAddress).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const found = DEPOSIT_NETWORKS.filter((n) => (balances?.[n.id] ?? 0) >= 1);

  return (
    <>
      <Eyebrow style={{ marginTop: 22, marginBottom: 10 }}>Or from another wallet</Eyebrow>
      <List>
        <Row>
          <RowIcon accent>
            <Icons.Wallet size={18} color={colors.accent} />
          </RowIcon>
          <RowMeta>
            <Txt style={{ ...fonts.mono400, fontSize: 14, color: colors.ink }}>
              {`${evmAddress.slice(0, 6)}…${evmAddress.slice(-4)}`}
            </Txt>
            <Txt style={[type.rowTime, { marginTop: 2 }]}>Works on Base, Arbitrum and Ethereum</Txt>
          </RowMeta>
          <Pressable onPress={copy} hitSlop={8} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.6 }]}>
            <Icons.Copy size={16} color={colors.accent} strokeWidth={1.6} />
            <Txt style={{ ...fonts.body500, fontSize: 14, color: colors.accent }}>{copied ? 'Copied' : 'Copy'}</Txt>
          </Pressable>
        </Row>
      </List>
      {found.map((n) => (
        <Btn
          key={n.id}
          label={depositBusy ? 'Moving…' : `Move $${(balances?.[n.id] ?? 0).toFixed(2)} from ${n.name}`}
          disabled={depositBusy}
          onPress={() => void doMoveToBalance(n.id)}
          style={{ marginTop: 10 }}
        />
      ))}
      <View style={{ alignItems: 'center', marginTop: 10 }}>
        <TextLink
          label={depositBusy ? 'Checking…' : balances && found.length === 0 ? 'Nothing there yet — check again' : 'Check for money'}
          onPress={() => void checkDeposits()}
        />
      </View>
      {error && balances ? <Txt style={[type.rowTime, { color: colors.danger, marginTop: 6, textAlign: 'center' }]}>{error}</Txt> : null}
    </>
  );
}

export function AddMoney() {
  const close = usePayStore((s) => s.close);
  const doAdd = usePayStore((s) => s.doAdd);
  const walletAddress = usePayStore((s) => s.walletAddress);
  const [amt, setAmt] = useState(100);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    haptic();
    await navigator.clipboard.writeText(walletAddress).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <>
      <Grab />
      <SheetHeader title="Add money" onClose={close} />
      <SheetBody>
        <Txt style={type.lead}>Top up your dollar balance.</Txt>
        <View style={{ marginTop: 16 }}>
          <Chips>
            {CHIPS.map((v) => (
              <Chip key={v} label={`$${v}`} on={amt === v} onPress={() => setAmt(v)} />
            ))}
          </Chips>
        </View>
        <Field style={{ marginTop: 12 }}>
          <Txt style={[type.fieldText, { color: colors.muted }]}>$</Txt>
          <input
            value={amt ? String(amt) : ''}
            onChange={(e) => {
              const n = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10);
              setAmt(Number.isNaN(n) ? 0 : Math.min(n, 100000));
            }}
            inputMode="decimal"
            placeholder="0"
            style={sx(type.fieldText, { flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: 0, color: colors.ink })}
          />
        </Field>
        <Btn label={`Add $${amt}`} disabled={amt <= 0} onPress={() => doAdd(amt)} style={{ marginTop: 16 }} />
        <FromAnotherWallet />
        {walletAddress ? (
          <>
            <Eyebrow style={{ marginTop: 22, marginBottom: 10 }}>Or add manually</Eyebrow>
            <List>
              <Row>
                <RowIcon accent>
                  <Icons.Qr size={18} color={colors.accent} />
                </RowIcon>
                <RowMeta>
                  <Txt style={{ ...fonts.mono400, fontSize: 14, color: colors.ink }}>
                    {`${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`}
                  </Txt>
                  {/* On-ramp is an allowed chain-surface context — and the label prevents
                      wrong-network deposits (money sent on another chain is unrecoverable). */}
                  <Txt style={[type.rowTime, { marginTop: 2 }]}>Solana · only send on this network</Txt>
                </RowMeta>
                <Pressable onPress={copy} hitSlop={8} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.6 }]}>
                  <Icons.Copy size={16} color={colors.accent} strokeWidth={1.6} />
                  <Txt style={{ ...fonts.body500, fontSize: 14, color: colors.accent }}>{copied ? 'Copied' : 'Copy'}</Txt>
                </Pressable>
              </Row>
            </List>
          </>
        ) : null}
      </SheetBody>
    </>
  );
}
