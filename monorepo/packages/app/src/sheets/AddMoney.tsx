'use client';

// AddMoney.tsx — card funding first, with an explicit external-wallet deposit option.
// The three EVM chains share ONE
// smart-wallet address (identical on each), so choosing Base/Arbitrum/Ethereum shows the same
// address (we say so); Solana has its own.
import { useEffect, useState } from 'react';

import {
  Btn,
  Chip,
  Chips,
  colors,
  Eyebrow,
  fonts,
  Grab,
  haptic,
  Icons,
  List,
  Pressable,
  Row,
  RowIcon,
  RowMeta,
  SearchBar,
  SheetBody,
  SheetHeader,
  TextLink,
  Txt,
  type,
  View,
} from '@fpay/ui';
import { getPaymentBridge, merchantApi } from '../services/merchantPayments';
import { friendlyError } from '../lib/errors';
import { platform } from '../platform';
import { QrCode } from '../components/QrCode';
import { usePayStore } from '../store';

const ALL_NETWORKS: Array<{
  id: string;
  name: string;
  chain: 'evm' | 'solana';
}> = [
  { id: 'base', name: 'Base', chain: 'evm' },
  { id: 'arbitrum', name: 'Arbitrum', chain: 'evm' },
  { id: 'ethereum', name: 'Ethereum', chain: 'evm' },
  { id: 'solana', name: 'Solana', chain: 'solana' },
];
// The EVM chips bridge through CCTP on mainnet; until the backend's minter is configured they
// answer `crosschain_unavailable`, which has its own copy.
const networks = () => ALL_NETWORKS;

function DepositFromWallet() {
  const evmAddress = usePayStore((s) => s.evmDepositAddress);
  const solAddress = usePayStore((s) => s.walletAddress);
  const balances = usePayStore((s) => s.depositBalances);
  const depositBusy = usePayStore((s) => s.depositBusy);
  const checkDeposits = usePayStore((s) => s.checkDeposits);
  const doMoveToBalance = usePayStore((s) => s.doMoveToBalance);
  const error = usePayStore((s) => s.error);
  const [net, setNet] = useState('solana');
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  if (!evmAddress && !solAddress) return null; // no wallet yet (dev mode / first login still provisioning)

  const sel = networks().find((n) => n.id === net) ?? networks()[0];
  const address = sel.chain === 'evm' ? evmAddress : solAddress;
  const copy = async () => {
    if (!address) return;
    haptic();
    await platform()
      .copy(address)
      .catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  // EVM deposits are detected then bridged to balance (CCTP); Solana lands directly, so no "move".
  const found = networks().filter((n) => n.chain === 'evm' && (balances?.[n.id] ?? 0) >= 1);

  return (
    <>
      <Eyebrow style={{ marginTop: 22, marginBottom: 10 }}>Deposit USDC from another wallet</Eyebrow>
      <Chips>
        {networks().map((n) => (
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
                  {sel.chain === 'evm'
                    ? 'Same address on Base, Arbitrum and Ethereum'
                    : 'Solana · only send on this network'}
                </Txt>
              </RowMeta>
              <Pressable
                onPress={copy}
                hitSlop={8}
                style={({ pressed }) => [
                  { flexDirection: 'row', alignItems: 'center', gap: 6 },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Icons.Copy size={16} color={colors.accent} strokeWidth={1.6} />
                <Txt
                  style={{
                    ...fonts.body500,
                    fontSize: 14,
                    color: colors.accent,
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Txt>
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
              }}
            >
              <QrCode value={address} size={176} />
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
                  label={
                    depositBusy ? 'Moving…' : `Move $${(balances?.[n.id] ?? 0).toFixed(2)} from ${n.name}`
                  }
                  disabled={depositBusy}
                  onPress={() => void doMoveToBalance(n.id)}
                  style={{ marginTop: 10 }}
                />
              ))
            : null}
          {sel.chain === 'evm' ? (
            <View style={{ alignItems: 'center', marginTop: 10 }}>
              <TextLink
                label={
                  depositBusy
                    ? 'Checking…'
                    : balances && found.length === 0
                      ? 'Nothing there yet, check again'
                      : 'Check for money'
                }
                onPress={() => void checkDeposits()}
              />
            </View>
          ) : null}
          {error && balances ? (
            <Txt style={[type.rowTime, { color: colors.danger, marginTop: 6, textAlign: 'center' }]}>
              {error}
            </Txt>
          ) : null}
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
  const address = usePayStore((s) => s.walletAddress);
  const [enabled, setEnabled] = useState(false);
  const [amount, setAmount] = useState('25');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [external, setExternal] = useState(false);
  useEffect(() => {
    let active = true;
    void merchantApi
      .capabilities()
      .then((c) => {
        if (active) setEnabled(c.cardFunding);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const fund = async () => {
    if (busy || !address) return;
    setBusy(true);
    setNotice('');
    try {
      const bridge = getPaymentBridge();
      if (!bridge) throw new Error('sponsorship_unsupported');
      await bridge.fund(address, amount);
      setNotice('Your balance updates once the money arrives. Closing checkout does not confirm payment.');
      await usePayStore.getState().refresh();
    } catch (e) {
      setNotice(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Grab />
      <SheetHeader title="Add money" onClose={close} />
      <SheetBody>
        <Txt style={type.lead}>Add money by card</Txt>
        {enabled && getPaymentBridge() ? (
          <>
            <Txt style={[type.rowTime, { marginTop: 12 }]}>Amount to add (USD)</Txt>
            <SearchBar placeholder="25" value={amount} onChangeText={setAmount} />
            <Txt style={[type.rowTime, { marginTop: 12 }]}>
              Review the card charge, conversion and fees in checkout. Funds may take a little time to arrive.
            </Txt>
            <Btn
              label={busy ? 'Opening checkout…' : 'Continue to card checkout'}
              disabled={
                busy ||
                !address ||
                !/^\d+(?:\.\d{1,2})?$/.test(amount) ||
                Number(amount) <= 0 ||
                Number(amount) > 10000
              }
              onPress={() => void fund()}
              style={{ marginTop: 16 }}
            />
          </>
        ) : (
          <Txt style={[type.rowTime, { marginTop: 12 }]}>
            Card funding is not available for this account yet.
          </Txt>
        )}
        {notice ? <Txt style={[type.rowTime, { marginTop: 12 }]}>{notice}</Txt> : null}
        <View style={{ marginTop: 24 }}>
          <TextLink
            label={external ? 'Hide wallet deposit' : 'Deposit from another wallet'}
            onPress={() => setExternal((v) => !v)}
          />
        </View>
        {external ? <DepositFromWallet /> : null}
      </SheetBody>
    </>
  );
}
