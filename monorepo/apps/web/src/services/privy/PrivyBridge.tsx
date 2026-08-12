'use client';

// PrivyBridge — the ONE place Privy hooks are called. Bridges Privy's hook state into the
// imperative zustand store (so screens never import Privy) and registers the PrivySigner.
// Web SDK: @privy-io/react-auth (+ /solana for the embedded Solana wallet).
import { useLinkPhone, useLinkWithPasskey, useLoginWithEmail, usePrivy } from '@privy-io/react-auth';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { useCreateWallet, useSignAndSendTransaction, useWallets } from '@privy-io/react-auth/solana';
import { useEffect, useRef } from 'react';

import { base58encode } from '@/lib/base58';
import { setAuthToken, setTokenRefresher } from '@/services/api';
import { IS_MAINNET } from '@/services/envConfig';
import { setActiveSigner } from '@/services/signer';
import { usePayStore } from '@/store/usePayStore';

import { PrivySigner } from './signer';

// Must match the cluster the backend builds transactions for — derived from the RPC env, never
// hardcoded (a devnet-pinned chain id silently breaks every mainnet broadcast).
const SOLANA_CHAIN = IS_MAINNET ? ('solana:mainnet' as const) : ('solana:devnet' as const);

export function PrivyBridge(): null {
  const { user, ready, getAccessToken, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { linkWithPasskey } = useLinkWithPasskey();
  const { sendCode: sendPhoneCode, linkWithCode: linkPhoneWithCode } = useLinkPhone();
  const { client: smartClient, getClientForChain } = useSmartWallets();

  // Register imperative auth actions into the store (screens call these, not Privy hooks).
  useEffect(() => {
    usePayStore.getState().setAuthBridge({
      sendCode: async (email) => {
        await sendCode({ email });
      },
      verifyCode: async (code) => {
        await loginWithCode({ code });
      },
      logout: async () => {
        await logout();
        // Clear all auth state so nothing stale lingers after sign-out.
        setAuthToken(null);
        setTokenRefresher(null);
        setActiveSigner(null);
      },
      linkPasskey: async () => {
        await linkWithPasskey();
      },
      // Pay-by-phone: Privy owns the SMS OTP; the backend then reads the linked number.
      sendPhoneCode: async (phoneNumber) => {
        await sendPhoneCode({ phoneNumber });
      },
      linkPhoneCode: async (code) => {
        await linkPhoneWithCode({ code });
      },
    });
  }, [sendCode, loginWithCode, logout, linkWithPasskey, sendPhoneCode, linkPhoneWithCode]);

  // Inbound cross-chain (docs/19): the smart wallet IS the deposit address (same 0x on every
  // chain). Publish it to the backend once known, and register the sponsored-call sender.
  const smartAddress = smartClient?.account?.address;
  useEffect(() => {
    if (!user || !smartAddress) return;
    void usePayStore.getState().syncEvmAddress(smartAddress);
    usePayStore.getState().setDepositBridge({
      sendSponsoredCalls: async (chainId, calls) => {
        const chainClient = await getClientForChain({ id: chainId });
        if (!chainClient) throw new Error('smart wallet unavailable for this network');
        return chainClient.sendTransaction({
          calls: calls.map((c) => ({
            to: c.to as `0x${string}`,
            data: c.data as `0x${string}`,
            value: BigInt(c.value || '0'),
          })),
        });
      },
    });
  }, [user, smartAddress, getClientForChain]);

  // Publish real recovery status (linked email + passkey) for the Recovery sheet + Settings.
  useEffect(() => {
    if (!user) return;
    const email = (user.email as { address?: string } | undefined)?.address ?? '';
    const passkey = (user.linkedAccounts ?? []).some((a) => a.type === 'passkey');
    usePayStore.getState().setRecoveryStatus({ email, passkey });
  }, [user]);

  // Once authenticated: ensure an embedded Solana wallet, then publish token + signer + address.
  const wallet = wallets?.[0];
  const creatingRef = useRef(false);
  useEffect(() => {
    if (!ready || !user) return undefined;
    let cancelled = false;
    (async () => {
      if (!wallet) {
        // Create the embedded Solana wallet at most once — Privy errors on a second call
        // (or if one already exists). Reset only on failure so a later run can retry.
        if (!creatingRef.current) {
          creatingRef.current = true;
          try {
            await createWallet();
          } catch (e) {
            creatingRef.current = false;
            throw e;
          }
        }
        return; // effect re-runs when wallets updates
      }
      const token = await getAccessToken();
      if (cancelled) return;
      setAuthToken(token);
      setTokenRefresher(getAccessToken); // api.ts refreshes an expired token on 401
      setActiveSigner(
        new PrivySigner(wallet.address, async (bytes) => {
          const { signature } = await signAndSendTransaction({ transaction: bytes, wallet, chain: SOLANA_CHAIN });
          return base58encode(signature);
        }),
      );
      usePayStore.getState().onSignedIn(wallet.address);
      void usePayStore.getState().load(); // returning users: pull balance/activity now the token is set
    })().catch((e) => usePayStore.setState({ authError: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [ready, user, wallet, createWallet, getAccessToken, signAndSendTransaction]);

  return null;
}
