'use client';

// PrivyBridge — the ONE place Privy hooks are called. Bridges Privy's hook state into the
// imperative zustand store (so screens never import Privy) and registers the PrivySigner.
// Web SDK: @privy-io/react-auth (+ /solana for the embedded Solana wallet).
import { useLoginWithEmail, usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useSignAndSendTransaction, useWallets } from '@privy-io/react-auth/solana';
import { useEffect, useRef } from 'react';

import { base58encode } from '@/lib/base58';
import { setAuthToken, setTokenRefresher } from '@/services/api';
import { setActiveSigner } from '@/services/signer';
import { usePayStore } from '@/store/usePayStore';

import { PrivySigner } from './signer';

const SOLANA_CHAIN = 'solana:devnet' as const; // matches the devnet backend

export function PrivyBridge(): null {
  const { user, ready, getAccessToken, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();

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
    });
  }, [sendCode, loginWithCode, logout]);

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
