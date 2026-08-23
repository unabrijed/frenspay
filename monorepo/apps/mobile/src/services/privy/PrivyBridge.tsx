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

import { LANDING_URL, SOLANA_RPC_URL } from '@/services/envConfig';

import { PrivySigner } from './signer';

// The wallet hook passes through these on the way to connected/not-created; acting on them reads
// an empty `wallets` as "no wallet" and creates a second one.
const SETTLING = new Set(['connecting', 'reconnecting', 'creating']);

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

  // Once authenticated: ensure an embedded Solana wallet, then publish token + signer + address.
  const wallet = solana.wallets?.[0];
  const status = solana.status as string;
  const creatingRef = useRef(false);
  useEffect(() => {
    if (!isReady || !user || SETTLING.has(status)) return undefined;
    let cancelled = false;
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
      const token = await getAccessToken();
      if (cancelled) return;
      setAuthToken(token);
      setTokenRefresher(getAccessToken);
      setSessionRevokedHandler(() => {
        const s = usePayStore.getState();
        if (s.onboarded || s.provisioned) void s.logout();
      });
      setAccountSuspendedHandler(() => usePayStore.setState({ suspended: true }));
      setAccountDeletedHandler(() => usePayStore.setState({ deleted: true }));
      setActiveSigner(new PrivySigner(wallet.address, () => wallet.getProvider(), SOLANA_RPC_URL));
      usePayStore.getState().onSignedIn(wallet.address);
      void usePayStore.getState().load();
    })().catch((e) =>
      usePayStore.setState({ authError: e instanceof Error ? e.message : String(e), authReady: true }),
    );
    return () => {
      cancelled = true;
    };
    // `solana` is a fresh object every render; status + address are the facts that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, user, status, wallet?.address, getAccessToken]);

  return null;
}
