'use client';

// PrivyBridge — the ONE place Privy hooks are called. Bridges Privy's hook state into the
// imperative zustand store (so screens never import Privy) and registers the PrivySigner.
// Web SDK: @privy-io/react-auth (+ /solana for the embedded Solana wallet).
import { useLinkWithPasskey, useLoginWithEmail, usePrivy } from '@privy-io/react-auth';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { useCreateWallet, useSignTransaction, useSignAndSendTransaction, useWallets } from '@privy-io/react-auth/solana';
import { useEffect, useRef } from 'react';

import { base58encode } from '@/lib/base58';
import {
  setAccountDeletedHandler,
  setAccountSuspendedHandler,
  setAuthToken,
  setSessionRevokedHandler,
  setTokenRefresher,
} from '@/services/api';
import { setActiveSigner } from '@/services/signer';
import { usePayStore } from '@/store/usePayStore';

import { PrivySigner } from './signer';

// Must match the cluster the backend builds transactions for — derived from the RPC env, never
// hardcoded (a devnet-pinned chain id silently breaks every mainnet broadcast).
const SOLANA_CHAIN = 'solana:mainnet' as const;

// A wallet that has not appeared this long after the session resolved is reported, not waited for.
const WALLET_TIMEOUT_MS = 15_000;
const WALLET_NOT_READY = 'wallet_not_ready'; // lib/errors has the copy

export function PrivyBridge(): null {
  const { user, ready, getAccessToken, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { signTransaction } = useSignTransaction();
  const { linkWithPasskey } = useLinkWithPasskey();
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
      // Pay-by-phone is NOT linked through Privy (its free plan only reaches US/CA numbers) — the
      // backend runs its own OTP; see store.startPhoneLink / services/phoneOtp.ts.
    });
  }, [sendCode, loginWithCode, logout, linkWithPasskey]);

  // "Signed out" is only an ANSWER once Privy has resolved and found no session. PrivyGate already
  // holds a splash until `ready`, but `ready` arriving with a user is not the end of it: authStatus
  // stays 'signedOut' through the token/wallet chain below, which on a cold load is seconds. The
  // entry router read that gap as a real no and sent returning users to the marketing screen — off
  // which nothing routes them back. So publish readiness only when there is genuinely nobody;
  // the signed-in half is published by onSignedIn once the chain lands.
  useEffect(() => {
    if (!ready) return undefined;
    if (!user) {
      usePayStore.getState().setAuthReady();
      return undefined;
    }
    // There IS a session, so wait for the token read below — but bounded: it can hang, and an
    // unbounded wait would hold the boot splash past the watchdog and reload in a loop. Falling
    // through unready is the welcome screen, which they can tap out of. Under SPLASH_WATCHDOG_MS on
    // purpose. (This used to wait for the whole wallet chain, which on a slow link regularly took
    // longer than 5 s — a signed-in person was shown the welcome screen, and an OTP if they acted.)
    const t = setTimeout(() => usePayStore.getState().setAuthReady(), 5000);
    return () => clearTimeout(t);
  }, [ready, user]);

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

  // Sign in on the TOKEN, not on the wallet. The wallet-proxy iframe (`walletsReady`, below) is the
  // slow part of a cold load and nothing about being signed in needs it: getAccessToken() reads the
  // stored token (one Privy refresh hop when it has expired — still never the iframe), and /me and
  // /balance only need the token. Waiting for the wallet here is what held the splash for seconds
  // and let the 5 s fallback above show the welcome screen to a signed-in person.
  useEffect(() => {
    if (!ready || !user) return undefined;
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (cancelled) return;
      // A stored session with nothing left to refresh: Privy has dropped its local state and this
      // is null. Publish nothing — signedIn with no token would land an onboarded user on a $0 Home
      // that every call 401s from. The fallback above publishes readiness; welcome is right.
      if (!token) return;
      setAuthToken(token);
      setTokenRefresher(getAccessToken); // api.ts asks it for the token on every call
      setSessionRevokedHandler(() => {
        // The backend confirmed this session has no account. Believe it about the ACCOUNT: the
        // persisted onboarded/handle/kycTier would otherwise keep rendering a dead account's app —
        // verified badge and all — forever. Not about the SESSION: this used to call logout(), and
        // when the one-Privy-app flip rotated every DID it cost every device a second OTP — the
        // first login's /me said no_account, the session was destroyed, and only the second login
        // reached the handle screen whose probe adopts the account by email. Forgetting the account
        // sends the same session straight to that probe.
        // Guarded because a pre-/auth/sync onboarding 401 is also 'no_account', and forgetting
        // mid-signup would wipe a half-finished one.
        const s = usePayStore.getState();
        if (s.onboarded || s.provisioned) s.forgetAccount();
      });
      // 403 account_suspended from any call → the full-screen paused state, not a silent $0
      // dashboard. Cleared by the next successful load()/refresh(), so reinstatement self-heals.
      setAccountSuspendedHandler(() => usePayStore.setState({ suspended: true }));
      setAccountDeletedHandler(() => usePayStore.setState({ deleted: true }));
      usePayStore.getState().onSignedIn();
      void usePayStore.getState().load(); // returning users: /me + balance/activity now the token is set
      // authReady rides along on the failure too: onSignedIn publishes it on success, so a throw
      // here would otherwise leave the boot router holding the splash forever.
    })().catch((e) =>
      usePayStore.setState({ authError: e instanceof Error ? e.message : String(e), authReady: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [ready, user, getAccessToken]);

  // The wallet, on its own clock: created for a brand-new account, then the signer and the address.
  // Gated on the wallet list being READY, not just `ready`+`user`: on a cold return Privy resolves
  // the session before it has listed the wallets, so `wallets` is briefly [] for a user who has
  // one. Without the gate that read as "no wallet" → createWallet → "User already has an embedded
  // wallet". The bridge OWNS `walletAddress` — the embedded wallet is the only address this client
  // can sign for — and writes it unconditionally; load() fills it from /me only while it is empty.
  const wallet = wallets?.[0];
  const walletAddr = wallet?.address;
  const creatingRef = useRef(false);
  useEffect(() => {
    if (!ready || !user || !walletsReady) return undefined;
    (async () => {
      if (!wallet) {
        // Privy has confirmed the list is empty (brand-new signup). Create the embedded Solana
        // wallet at most once — Privy errors on a second call. Reset only on failure so a later
        // run can retry.
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
      setActiveSigner(
        new PrivySigner(wallet.address, async (bytes, sponsored) => {
          // `sponsor` only when the backend built the tx for it (no fee-payer signature inside):
          // Privy's fee payer then rewrites the fee-payer field + blockhash before the user signs.
          // Asking to sponsor a fee-payer-signed tx would invalidate that signature.
          const { signature } = await signAndSendTransaction({
            transaction: bytes,
            wallet,
            chain: SOLANA_CHAIN,
            ...(sponsored ? { options: { sponsor: true } } : {}),
          });
          return base58encode(signature);
        }, async bytes => (await signTransaction({ transaction: bytes, wallet, chain: SOLANA_CHAIN, options: { uiOptions: { showWalletUIs: false } } })).signedTransaction),
      );
      usePayStore.setState((s) => ({
        walletAddress: wallet.address,
        ...(s.authError === WALLET_NOT_READY ? { authError: null } : {}),
      }));
    })().catch((e) => usePayStore.setState({ authError: e instanceof Error ? e.message : String(e) }));
    return undefined;
  }, [ready, user, walletsReady, wallet, createWallet, signAndSendTransaction, signTransaction]);

  // Bounded: a wallet that has not appeared WALLET_TIMEOUT_MS after the session resolved — iframe
  // blocked, creation wedged — used to fall through to the welcome screen via the 5 s fallback. Now
  // sign-in is already published, so the handle screen (the one place that needs the wallet) would
  // hold its splash forever; it renders this error with a reload instead.
  useEffect(() => {
    if (!ready || !user || walletAddr) return undefined;
    const t = setTimeout(() => usePayStore.setState({ authError: WALLET_NOT_READY }), WALLET_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready, user, walletAddr]);


  return null;
}
