'use client';

// PrivyBridge — the ONE place Privy hooks are called in this app. Bridges Privy's hook state into
// the imperative store (so screens never import Privy) and registers the signer.
//
// A trimmed sibling of apps/web's: email OTP and the embedded Solana wallet, and nothing else. No
// smart wallets (this console has no cross-chain deposits), no passkeys, no phone linking. Account
// creation is the one thing shared with the wallet app: AuthGate's FinishSetup calls /auth/sync.
import { useLoginWithEmail, usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useSignAndSendTransaction, useWallets } from '@privy-io/react-auth/solana';
import { useEffect, useRef } from 'react';

import { base58encode } from '@/lib/base58';
import { setAccountSuspendedHandler, setAuthToken, setSessionRevokedHandler, setTokenRefresher } from '@/services/api';
import { setActiveSigner } from '@/services/signer';
import { useLpStore } from '@/store/useLpStore';

import { PrivySigner } from './signer';

// Must match the cluster the backend builds transactions for — derived from the RPC env, never
// hardcoded (a devnet-pinned chain id silently breaks every mainnet broadcast).
const SOLANA_CHAIN = 'solana:mainnet' as const;

export function PrivyBridge(): null {
  const { user, ready, getAccessToken, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  // `ready` here is the WALLET list's readiness, which lags usePrivy().ready by the wallet-proxy
  // iframe: on a cold return `wallets` is [] for a beat even for a user who has one. Reading it as
  // "no wallet" called createWallet(), Privy threw ("already has an embedded wallet"), and the catch
  // below signed the partner out — an OTP on every cold return. Same gate apps/web already has.
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // Register imperative auth actions into the store (screens call these, not Privy hooks).
  useEffect(() => {
    useLpStore.getState().setAuthBridge({
      sendCode: async (email) => {
        await sendCode({ email });
      },
      verifyCode: async (code) => {
        await loginWithCode({ code });
      },
      logout: async () => {
        setAuthToken(null);
        setTokenRefresher(null);
        setActiveSigner(null); // no stale wallet authority lingering after a sign-out
        await logout();
        useLpStore.getState().onSignedOut();
      },
    });
  }, [sendCode, loginWithCode, logout]);

  // Privy resolved with no session → signedOut, so the sign-in screen renders instead of a splash.
  useEffect(() => {
    if (ready && !user) useLpStore.getState().onSignedOut();
  }, [ready, user]);

  // Once authenticated: ensure an embedded Solana wallet, then publish token + signer + address.
  const wallet = wallets?.[0];
  const creatingRef = useRef(false);
  useEffect(() => {
    if (!ready || !user || !walletsReady) return undefined;
    let cancelled = false;
    (async () => {
      if (!wallet) {
        // Create the embedded wallet at most once — Privy errors on a second call. Reset only on
        // failure so a later run can retry.
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

      // The backend confirmed this session has no fpay account on this environment. AuthGate then
      // renders FinishSetup (handle, plus an invite if asked) → /auth/sync, which creates the row or
      // adopts an existing one by email — the same door the wallet app uses, not a dead end.
      setSessionRevokedHandler(() => useLpStore.setState({ noAccount: true, loaded: true }));
      setAccountSuspendedHandler(() => useLpStore.setState({ suspended: true }));

      setActiveSigner(
        new PrivySigner(wallet.address, async (bytes, sponsored) => {
          // `sponsor` only when the backend built the tx for it (no fee-payer signature inside) —
          // Privy's fee payer rewrites the fee-payer field + blockhash; see docs/16 §Who pays gas.
          const { signature } = await signAndSendTransaction({
            transaction: bytes,
            wallet,
            chain: SOLANA_CHAIN,
            ...(sponsored ? { options: { sponsor: true } } : {}),
          });
          return base58encode(signature);
        }),
      );
      useLpStore.getState().onSignedIn(wallet.address);
      void useLpStore.getState().load();
    })().catch((e) => {
      // A bridge failure is shown, never turned into a sign-out: the session is fine, the wallet
      // chain isn't, and signing the partner out here asked them for an OTP that could not fix it.
      // The gate keeps its splash (authStatus stays 'loading'), so a reload is the retry.
      useLpStore.getState().notify(e instanceof Error ? e.message : String(e), 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [ready, user, walletsReady, wallet, createWallet, getAccessToken, signAndSendTransaction]);

  return null;
}
