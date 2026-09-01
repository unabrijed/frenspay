// PrivyBridge — the ONE place Privy hooks are called. Bridges Privy's hook state into the
// imperative store (so screens never import Privy) and registers the PrivySigner. Publishes the
// same shape the web bridge does (apps/web/src/services/privy/PrivyBridge.tsx) — the store cannot
// tell which SDK is underneath.
import {
  setAccountDeletedHandler,
  setAccountSuspendedHandler,
  setActiveSigner,
  setAuthToken,
  setSessionRevokedHandler,
  setTokenRefresher,
  usePayStore,
} from '@fpay/app';
import { useEmbeddedSolanaWallet, useLoginWithEmail, usePrivy } from '@privy-io/expo';
import { useLinkWithPasskey } from '@privy-io/expo/passkey';
import { useEffect, useRef } from 'react';

import { unregisterPush } from '@/push';
import { LANDING_URL, SOLANA_RPC_URL } from '@/services/envConfig';

import { PrivySigner } from './signer';

// The wallet hook passes through these on the way to connected/not-created; acting on them reads
// an empty `wallets` as "no wallet" and creates a second one.
const SETTLING = new Set(['connecting', 'reconnecting', 'creating']);

// A wallet that has not appeared this long after the session resolved is reported, not waited for.
const WALLET_TIMEOUT_MS = 15_000;
const WALLET_NOT_READY = 'wallet_not_ready'; // lib/errors has the copy

type LinkedAccount = { type: string; address?: string };

export function PrivyBridge(): null {
  const { user, isReady, getAccessToken, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const solana = useEmbeddedSolanaWallet();
  const { linkWithPasskey } = useLinkWithPasskey();

  // Register imperative auth actions into the store (screens call these, not Privy hooks).
  useEffect(() => {
    usePayStore.getState().setAuthBridge({
      sendCode: async (email) => {
        await sendCode({ email });
      },
      verifyCode: async (code) => {
        await loginWithCode({ code, email: usePayStore.getState().authEmail });
      },
      logout: async () => {
        await unregisterPush(); // while the token still authenticates
        await logout();
        setAuthToken(null);
        setTokenRefresher(null);
        setActiveSigner(null);
      },
      // The relying party is the marketing domain: it must serve /.well-known/assetlinks.json naming
      // this app's signing certificate before a phone can mint a passkey for it (Bridge-gated).
      linkPasskey: async () => {
        await linkWithPasskey({ relyingParty: LANDING_URL });
      },
    });
  }, [sendCode, loginWithCode, logout, linkWithPasskey]);

  // "Signed out" is only an ANSWER once Privy has resolved and found no session; with a session,
  // readiness is published by onSignedIn below — bounded, so a wedged wallet chain can't hold the
  // boot splash forever (same reasoning as the web bridge).
  useEffect(() => {
    if (!isReady) return undefined;
    if (!user) {
      usePayStore.getState().setAuthReady();
      return undefined;
    }
    const t = setTimeout(() => usePayStore.getState().setAuthReady(), 5000);
    return () => clearTimeout(t);
  }, [isReady, user]);

  // Recovery status (linked email + passkey) for the Recovery sheet + Settings.
  useEffect(() => {
    if (!user) return;
    const accounts = ((user as { linked_accounts?: LinkedAccount[] }).linked_accounts ?? []) as LinkedAccount[];
    const email = accounts.find((a) => a.type === 'email')?.address ?? '';
    const passkey = accounts.some((a) => a.type === 'passkey');
    usePayStore.getState().setRecoveryStatus({ email, passkey });
  }, [user]);

  // Sign in on the TOKEN, not on the wallet — see the web bridge: the wallet hook's settle is the
  // slow part of a cold start and nothing about being signed in needs it.
  useEffect(() => {
    if (!isReady || !user) return undefined;
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (cancelled) return;
      if (!token) return; // nothing left to refresh: the 5 s fallback above publishes readiness
      setAuthToken(token);
      setTokenRefresher(getAccessToken);
      setSessionRevokedHandler(() => {
        // Forget the account, keep the session — the handle screen's probe adopts it by email.
        // The web bridge explains the OTP loop that logout() here caused.
        const s = usePayStore.getState();
        if (s.onboarded || s.provisioned) s.forgetAccount();
      });
      setAccountSuspendedHandler(() => usePayStore.setState({ suspended: true }));
      setAccountDeletedHandler(() => usePayStore.setState({ deleted: true }));
      usePayStore.getState().onSignedIn();
      void usePayStore.getState().load();
    })().catch((e) =>
      usePayStore.setState({ authError: e instanceof Error ? e.message : String(e), authReady: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [isReady, user, getAccessToken]);

  // The wallet, on its own clock: created for a brand-new account, then the signer and the address
  // (the bridge owns `walletAddress`; load() fills it from /me only while it is empty).
  const wallet = solana.wallets?.[0];
  const walletAddr = wallet?.address;
  const status = solana.status as string;
  const creatingRef = useRef(false);
  useEffect(() => {
    if (!isReady || !user || SETTLING.has(status)) return undefined;
    (async () => {
      if (!wallet) {
        // Brand-new signup: create the embedded wallet at most once — Privy errors on a second call.
        // Reset only on failure so a later run can retry.
        if (status === 'not-created' && typeof solana.create === 'function' && !creatingRef.current) {
          creatingRef.current = true;
          try {
            await solana.create();
          } catch (e) {
            creatingRef.current = false;
            throw e;
          }
        }
        return; // effect re-runs when wallets updates
      }
      setActiveSigner(new PrivySigner(wallet.address, () => wallet.getProvider(), SOLANA_RPC_URL));
      usePayStore.setState((s) => ({
        walletAddress: wallet.address,
        ...(s.authError === WALLET_NOT_READY ? { authError: null } : {}),
      }));
    })().catch((e) => usePayStore.setState({ authError: e instanceof Error ? e.message : String(e) }));
    return undefined;
    // `solana` is a fresh object every render; status + address are the facts that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, user, status, walletAddr]);

  // Bounded wait for the wallet — see the web bridge. The phone cannot reload itself, so the handle
  // screen shows the error and asks for a fresh start.
  useEffect(() => {
    if (!isReady || !user || walletAddr) return undefined;
    const t = setTimeout(() => usePayStore.setState({ authError: WALLET_NOT_READY }), WALLET_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [isReady, user, walletAddr]);


  return null;
}
