// PrivyBridge — the ONE place Privy hooks are called. It bridges Privy's hook-based state into
// the imperative zustand store (so screens never import Privy) and registers the PrivySigner.
// Mounted only inside PrivyRoot, which is lazy-loaded only when USE_PRIVY (Expo Go stays clean).
import { useEmbeddedSolanaWallet, useLoginWithEmail, usePrivy } from '@privy-io/expo';
import { useEffect } from 'react';

import { setAuthToken } from '../api';
import { SOLANA_RPC_URL } from '../env';
import { setActiveSigner } from '../signer';
import { usePayStore } from '@/store/usePayStore';

import { PrivySigner } from './signer';

export function PrivyBridge(): null {
  const { user, isReady, getAccessToken, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const solana = useEmbeddedSolanaWallet();

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
      },
    });
  }, [sendCode, loginWithCode, logout]);

  // Once authenticated: ensure an embedded Solana wallet, then publish token + signer + address.
  const wallet = solana.wallets?.[0];
  useEffect(() => {
    if (!isReady || !user) return;
    let cancelled = false;
    (async () => {
      if (!wallet) {
        if (typeof solana.create === 'function') await solana.create();
        return; // effect re-runs when wallets updates
      }
      const token = await getAccessToken();
      if (cancelled) return;
      setAuthToken(token);
      setActiveSigner(new PrivySigner(wallet.address, () => wallet.getProvider(), SOLANA_RPC_URL));
      usePayStore.getState().onSignedIn(wallet.address);
      void usePayStore.getState().load(); // returning users: pull balance/activity now the token is set
    })().catch((e) => usePayStore.setState({ authError: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, user, wallet?.address]);

  return null;
}
