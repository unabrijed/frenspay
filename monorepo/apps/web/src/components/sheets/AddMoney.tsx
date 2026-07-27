'use client';

// AddMoney.tsx — bottom sheet: faucet top-up (amount chips + field) plus a network-aware USDC
// deposit picker (pick a chain → its address + scannable QR + copy). The three EVM chains share ONE
// smart-wallet address (identical on each), so choosing Base/Arbitrum/Ethereum shows the same
// address (we say so); Solana has its own.
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

import { Icons } from '@/components/icons';
import { Btn, TextLink } from '@/components/ui/Button';
import { Chip, Chips, Eyebrow, Field, Grab, List, Row, RowIcon, RowMeta, SheetBody, SheetHeader } from '@/components/ui/primitives';
import { haptic, Pressable, sx, View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { colors, fonts, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

const CHIPS = [50, 100, 250];

const NETWORKS: Array<{ id: string; name: string; chain: 'evm' | 'solana' }> = [
  { id: 'base', name: 'Base', chain: 'evm' },
  { id: 'arbitrum', name: 'Arbitrum', chain: 'evm' },
  { id: 'ethereum', name: 'Ethereum', chain: 'evm' },
  { id: 'solana', name: 'Solana', chain: 'solana' },
];

function DepositFromWallet() {
  const evmAddress = usePayStore((s) => s.evmDepositAddress);
  const solAddress = usePayStore((s) => s.walletAddress);
  const balances = usePayStore((s) => s.depositBalances);
  const depositBusy = usePayStore((s) => s.depositBusy);
  const checkDeposits = usePayStore((s) => s.checkDeposits);
  const doMoveToBalance = usePayStore((s) => s.doMoveToBalance);
  const error = usePayStore((s) => s.error);
  const [net, setNet] = useState('base');
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  if (!evmAddress && !solAddress) return null; // no wallet yet (dev mode / first login still provisioning)

  const sel = NETWORKS.find((n) => n.id === net) ?? NETWORKS[0];
  const address = sel.chain === 'evm' ? evmAddress : solAddress;
  const copy = async () => {
    if (!address) return;
    haptic();
    await navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  // EVM deposits are detected then bridged to balance (CCTP); Solana lands directly, so no "move".
  const found = NETWORKS.filter((n) => n.chain === 'evm' && (balances?.[n.id] ?? 0) >= 1);

  return (
    <>
      <Eyebrow style={{ marginTop: 22, marginBottom: 10 }}>Deposit USDC from another wallet</Eyebrow>
      <Chips>
        {NETWORKS.map((n) => (
          <Chip
            key={n.id}
            label={n.name}
            on={net === n.id}
            onPress={() => {
              setNet(n.id);
              setShowQr(false);
              setCopied(false);
            }}
          />
        ))}
      </Chips>
      {address ? (
        <>
          <List>
            <Row>
              <RowIcon accent>
                <Icons.Wallet size={18} color={colors.accent} />
              </RowIcon>
              <RowMeta>
                <Txt style={{ ...fonts.mono400, fontSize: 14, color: colors.ink }}>
                  {`${address.slice(0, 6)}…${address.slice(-4)}`}
                </Txt>
                <Txt style={[type.rowTime, { marginTop: 2 }]}>
                  {sel.chain === 'evm' ? 'Same address on Base, Arbitrum and Ethereum' : 'Solana · only send on this network'}
                </Txt>
              </RowMeta>
              <Pressable onPress={copy} hitSlop={8} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.6 }]}>
                <Icons.Copy size={16} color={colors.accent} strokeWidth={1.6} />
                <Txt style={{ ...fonts.body500, fontSize: 14, color: colors.accent }}>{copied ? 'Copied' : 'Copy'}</Txt>
              </Pressable>
            </Row>
          </List>
          <View style={{ alignItems: 'center', marginTop: 10 }}>
            <TextLink label={showQr ? 'Hide QR code' : 'Show QR code'} onPress={() => setShowQr((v) => !v)} />
          </View>
          {showQr ? (
            <View
              style={{
                alignSelf: 'center',
                marginTop: 12,
                padding: 16,
                backgroundColor: colors.white,
                borderRadius: 24,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: colors.hair,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <QRCodeSVG value={address} size={176} bgColor="#FFFFFF" fgColor={colors.ink} level="M" />
            </View>
          ) : null}
          {/* On-ramp is an allowed chain-surface context, and the warning prevents wrong-network
              deposits (money sent on another chain is unrecoverable). */}
          <Txt style={[type.rowTime, { marginTop: 10, textAlign: 'center' }]}>
            {`Send only USDC on ${sel.name}. Funds sent on another network can’t be recovered.`}
          </Txt>
          {sel.chain === 'evm'
            ? found.map((n) => (
                <Btn
                  key={n.id}
                  label={depositBusy ? 'Moving…' : `Move $${(balances?.[n.id] ?? 0).toFixed(2)} from ${n.name}`}
                  disabled={depositBusy}
                  onPress={() => void doMoveToBalance(n.id)}
                  style={{ marginTop: 10 }}
                />
              ))
            : null}
          {sel.chain === 'evm' ? (
            <View style={{ alignItems: 'center', marginTop: 10 }}>
              <TextLink
                label={depositBusy ? 'Checking…' : balances && found.length === 0 ? 'Nothing there yet — check again' : 'Check for money'}
                onPress={() => void checkDeposits()}
              />
            </View>
          ) : null}
          {error && balances ? <Txt style={[type.rowTime, { color: colors.danger, marginTop: 6, textAlign: 'center' }]}>{error}</Txt> : null}
        </>
      ) : (
        <Txt style={[type.rowTime, { marginTop: 10 }]}>
          Your {sel.name} deposit address is being set up. Check back in a moment.
        </Txt>
      )}
    </>
  );
}

export function AddMoney() {
  const close = usePayStore((s) => s.close);
  const doAdd = usePayStore((s) => s.doAdd);
  const busy = usePayStore((s) => s.busy);
  const [amt, setAmt] = useState(100);
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
        <Btn label={busy ? 'Adding…' : `Add $${amt}`} disabled={amt <= 0 || busy} onPress={() => doAdd(amt)} style={{ marginTop: 16 }} />
        <DepositFromWallet />
      </SheetBody>
    </>
  );
}
