// usePayStore.ts — the single screen-state controller, ported from
// design-reference/app.jsx. balanceUSD is the source of truth; INR is always
// derived. Persisted fields survive reload (replaces the prototype's localStorage).
//
// Money flows delegate to the RealWalletProvider (@/services/wallet) → the backend API + on-device
// signing. The app is always real; balance/activity load from the backend once signed in.
import type { ApiPaymentRequest, KycStatus, Notification, Order, Quote } from '@fpay/shared';
import type { NetworkId } from '@fpay/shared';
import { isoFromE164, phoneCandidates, truncateAddress } from '@fpay/shared';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { bootTrace } from '@/lib/boot';
import type { DisplayCurrency } from '@/lib/money';
import { parseScannedQR } from '@/lib/qr';
import { api, ApiError, setAuthToken } from '@/services/api';
import { getActiveSigner } from '@/services/signer';
import { USE_PRIVY } from '@/services/env';
import { confirmOrder as apiConfirmOrder, createQuote as apiCreateQuote, getOrder as apiGetOrder } from '@/services/orders';
import { FRIENDS, wallet, type Friend, type Merchant, type Txn } from '@/services/wallet';

export type SheetId =
  | 'scan'
  | 'amount'
  | 'add'
  | 'send'
  | 'sendAmount'
  | 'sendAddressAmount'
  | 'sendAddressConfirm'
  | 'sendNetwork'
  | 'request'
  | 'requestPick'
  | 'requestSent'
  | 'sent'
  | 'sendFailed'
  | 'verify'
  | 'recovery'
  | 'payByPhone'
  | 'receive'
  | 'currency'
  | 'country'
  | 'quote'
  | 'tracking'
  | 'help'
  | 'notifications';

const SHEET_EXIT_MS = 280;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

/** Imperative auth actions registered by the Privy bridge (real mode only). */
interface AuthBridge {
  sendCode: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Link a passkey to the Privy user — a cross-device recovery factor. */
  linkPasskey: () => Promise<void>;
  /** Pay-by-phone: Privy sends the SMS OTP to link the number to the account. */
  sendPhoneCode: (phoneNumber: string) => Promise<void>;
  linkPhoneCode: (code: string) => Promise<void>;
}

interface PayState {
  // ---- persisted ----
  onboarded: boolean;
  kycTier: number;
  recovered: boolean;
  recoveryPrompted: boolean;
  balanceUSD: number;
  fxRate: number; // live INR-per-USD mid rate (M7), for standalone INR display
  transactions: Txn[];
  notifications: Notification[];
  unread: number;
  displayCurrency: DisplayCurrency;
  handle: string;
  /** Own pay-by-phone alias (E.164) — '' when not enrolled. Server truth via /me. */
  phone: string;
  /** Dialing-default country (ISO alpha-2) — '' when unknown. Server truth via /me. */
  country: string;
  /** Own EVM deposit address (smart wallet) — '' until Privy creates + we sync it. */
  evmDepositAddress: string;
  /** USDC found at the deposit address per network (from "Check for money"). */
  depositBalances: Record<string, number> | null;
  depositBusy: boolean;

  // ---- ephemeral ----
  sheet: SheetId | null;
  closing: boolean;
  merchant: Merchant;
  friend: Friend;
  payRupees: number;
  /** Rupee amount carried in from a scanned (dynamic) UPI QR; 0 = enter manually. */
  scannedRupees: number;
  detail: Txn | null;
  pendingPay: boolean;
  /** Real-vendor verification lifecycle (M7): 'pending' while the user is in/returning from the flow. */
  kycStatus: KycStatus;
  /** In-flight direct send to a raw wallet address (outside fpay). network 'evm' = family
   *  detected, user hasn't picked the chain yet; fees populate once amount + network are known. */
  externalSend: {
    address: string;
    amountUsd: number;
    network: NetworkId | 'evm';
    feeUsd: number;
    railFeeUsd: number;
    totalFeeUsd: number;
    etaSecs: number;
  } | null;
  lastSend: { u: number; handle: string };
  lastRequest: { u: number; handle: string };
  requestDraftUsd: number;
  requests: ApiPaymentRequest[];
  busy: boolean;
  /** True once the first signed-in load() of this SESSION has resolved. Ephemeral (never persisted)
   *  so every fresh app load starts false → screens show skeletons until live data arrives, instead
   *  of flashing persisted (possibly stale / prior-session) balance + activity. */
  firstLoadDone: boolean;
  error: string | null;
  walletAddress: string;
  // ---- M1 order lifecycle (quote engine + order state machine) ----
  quote: Quote | null;
  order: Order | null;

  // ---- auth (Privy email OTP; real mode) ----
  authStatus: 'signedOut' | 'codeSent' | 'signedIn';
  authEmail: string;
  authError: string | null;
  // Real recovery status, published by the Privy bridge.
  recoveryEmail: string;
  recoveryPasskey: boolean;
  _authBridge?: AuthBridge;

  // ---- sheet control ----
  open: (id: SheetId) => void;
  close: () => void;

  // ---- in-flight context ----
  setMerchant: (m: Merchant) => void;
  setFriend: (f: Friend) => void;
  setPayRupees: (r: number) => void;
  setRequestDraft: (u: number) => void;
  openDetail: (tx: Txn) => void;
  setDisplayCurrency: (c: DisplayCurrency) => void;

  // ---- backend sync (real mode only) ----
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  readNotifications: () => Promise<void>;

  // ---- payment requests ----
  requestMoney: (handle: string, amountUsd: number, note?: string) => Promise<void>;
  payRequest: (id: string) => Promise<void>;
  cancelRequest: (id: string) => Promise<void>;

  // ---- auth actions (delegate to the Privy bridge) ----
  setAuthBridge: (b: AuthBridge) => void;
  onSignedIn: (walletAddress: string) => void;
  requestOtp: (email: string) => Promise<void>;
  verifyOtp: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  authSync: (handle: string) => Promise<void>;
  /** Dev-only: reset backend KYC tier + local state and sign out, to re-test onboarding + KYC. */
  resetForTesting: () => Promise<void>;

  // ---- flows (mirror app.jsx) ----
  /** Decode a scanned QR and route to the right flow (send / merchant-pay). */
  handleScan: (text: string) => Promise<void>;
  payMerchant: (m: Merchant, rupees?: number) => void;
  verifyDone: () => void;
  /** After returning from the hosted KYC flow: poll /me until the vendor decision lands. */
  pollKyc: () => Promise<void>;
  /** Resume a merchant-pay interrupted by the hosted-KYC redirect (reads the sessionStorage stash). */
  resumePayAfterKyc: () => void;
  recoveryDone: () => void;
  /** Publish real recovery status from the Privy bridge. */
  setRecoveryStatus: (s: { email: string; passkey: boolean }) => void;
  // ---- pay-by-phone (UPI-mapper consent model: enrolling IS the consent) ----
  /** Step 1: send the SMS code via Privy. Dev mode (no Privy) enrolls directly. */
  startPhoneLink: (phoneNumber: string) => Promise<'code_sent' | 'enrolled'>;
  /** Step 2: confirm the SMS code, then enroll server-side (number read from Privy). */
  confirmPhoneLink: (code: string) => Promise<void>;
  /** Opt out: remove the number from the directory. */
  disablePayByPhone: () => Promise<void>;
  /** Set the dialing-default country (Settings pick or derived from the enrolled phone). */
  setCountry: (iso: string) => Promise<void>;
  // ---- inbound cross-chain deposits (docs/19) ----
  /** Registered by the Privy bridge: sends a paymaster-sponsored batched userOp. */
  setDepositBridge: (b: { sendSponsoredCalls: (chainId: number, calls: Array<{ to: string; data: string; value: string }>) => Promise<string> }) => void;
  _depositBridge?: { sendSponsoredCalls: (chainId: number, calls: Array<{ to: string; data: string; value: string }>) => Promise<string> };
  /** Publish the smart-wallet deposit address to the backend (idempotent). */
  syncEvmAddress: (address: string) => Promise<void>;
  /** Read USDC balances at the deposit address across networks. */
  checkDeposits: () => Promise<void>;
  /** Burn the detected balance on `network` (sponsored, user-signed) and report it for settling. */
  doMoveToBalance: (network: string) => Promise<void>;
  /** Re-report a burn whose report never reached the server (localStorage stash). */
  resumePendingDeposit: () => Promise<void>;
  /** Link a passkey as a second-device recovery factor (delegates to Privy). */
  addPasskey: () => Promise<void>;
  finishPay: () => void;
  doSend: (u: number) => Promise<Txn | null>;
  doAdd: (amt: number) => Promise<void>;

  // ---- direct send to a raw wallet address (docs/16 + cross-chain docs/19) ----
  /** Route a detected wallet address: Solana → amount entry; EVM family → network picker. */
  startExternalSend: (address: string, network: 'solana' | 'evm') => void;
  /** Pick the destination network for an EVM-family address (live rails only). */
  selectNetwork: (id: NetworkId) => void;
  /** Stash the amount and advance to confirm; cross-chain fetches the fee/ETA quote here. */
  setExternalAmount: (u: number) => Promise<void>;
  /** Execute the confirmed external send (tier-gated + validated server-side). */
  doSendExternal: () => Promise<Txn | null>;

  // ---- order lifecycle: quote → confirm (sign escrow funding) → poll ----
  /** Request a locked quote for a rupee amount and open the Quote screen. */
  getQuote: (rupees: number) => Promise<void>;
  /** Confirm the live quote: create the order, sign the escrow funding, open the timeline. */
  confirmOrder: () => Promise<void>;
  /** Poll the in-flight order; refreshes balance once it reaches a terminal state. */
  refreshOrder: () => Promise<void>;
  /** Discard the quote and go back to amount entry. */
  editQuote: () => void;

  // ---- onboarding ----
  completeOnboarding: () => void;
}

export const usePayStore = create<PayState>()(
  persist(
    (set, get) => ({
      onboarded: false,
      kycTier: 1,
      recovered: false,
      recoveryPrompted: false,
      balanceUSD: 0,
      fxRate: 87.55,
      transactions: [],
      notifications: [],
      unread: 0,
      displayCurrency: 'INR',
      handle: '',
      phone: '',
      country: '',
      evmDepositAddress: '',
      depositBalances: null,
      depositBusy: false,

      sheet: null,
      closing: false,
      merchant: { name: 'Anjuna Beach Cafe' },
      friend: FRIENDS[0],
      payRupees: 500,
      scannedRupees: 0,
      detail: null,
      pendingPay: false,
      kycStatus: 'none',
      externalSend: null,
      lastSend: { u: 12, handle: '@neha' },
      lastRequest: { u: 20, handle: '@neha' },
      requestDraftUsd: 20,
      requests: [],
      busy: false,
      firstLoadDone: false,
      error: null,
      walletAddress: '',
      quote: null,
      order: null,

      authStatus: 'signedOut',
      authEmail: '',
      authError: null,
      recoveryEmail: '',
      recoveryPasskey: false,
      _authBridge: undefined,

      open: (id) => {
        if (closeTimer) {
          clearTimeout(closeTimer);
          closeTimer = null;
        }
        set({ sheet: id, closing: false });
      },
      close: () => {
        if (!get().sheet) return;
        set({ closing: true });
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
          set({ sheet: null, closing: false });
          closeTimer = null;
        }, SHEET_EXIT_MS);
      },

      setMerchant: (m) => set({ merchant: m }),
      setFriend: (f) => set({ friend: f }),
      setPayRupees: (r) => set({ payRupees: r }),
      setRequestDraft: (u) => set({ requestDraftUsd: u }),
      openDetail: (tx) => set({ detail: tx }),
      setDisplayCurrency: (c) => set({ displayCurrency: c }),

      // Pull identity + balance + activity from the backend (no-op in mock mode).
      load: async () => {
        if (USE_PRIVY && get().authStatus !== 'signedIn') return; // wait for the Privy bridge to sign in
        // First load of this session: drop any persisted prior-session financials so they can't flash
        // before the fresh fetch resolves. Skeletons (gated on firstLoadDone) cover the gap. Identity
        // (handle/kycTier) is left intact — load() repopulates it and losing it would break routing.
        if (!get().firstLoadDone) {
          set({ balanceUSD: 0, transactions: [], requests: [], notifications: [], unread: 0 });
        }
        set({ busy: true, error: null });
        try {
          const [me, bal, txns, reqs, notifs, fx] = await Promise.all([
            api.me(),
            wallet.getBalanceUsd(),
            wallet.getTransactions(),
            wallet.getRequests(),
            // Non-critical: a failing /notifications must never blank the dashboard.
            api.getNotifications().catch(() => ({ notifications: get().notifications, unread: get().unread })),
            api.fxRate().catch(() => ({ rate: get().fxRate, asOf: null })),
          ]);
          set({
            walletAddress: me.walletAddress,
            handle: me.handle,
            phone: me.phone ?? '',
            country: me.country ?? '',
            evmDepositAddress: me.evmDepositAddress ?? '',
            kycTier: me.kycTier,
            kycStatus: me.kycStatus ?? 'none',
            balanceUSD: bal,
            fxRate: fx.rate,
            transactions: txns,
            requests: reqs,
            notifications: notifs.notifications,
            unread: notifs.unread,
            busy: false,
            firstLoadDone: true,
          });
          void get().resumePendingDeposit(); // lost-burn-hash recovery (docs/19 inbound)
        } catch (e) {
          // Mark firstLoadDone even on failure so skeletons resolve to the empty/error state
          // rather than spinning forever.
          set({ busy: false, firstLoadDone: true, error: e instanceof Error ? e.message : String(e) });
        }
      },
      refresh: async () => {
        try {
          const [bal, txns, reqs, notifs] = await Promise.all([
            wallet.getBalanceUsd(),
            wallet.getTransactions(),
            wallet.getRequests(),
            api.getNotifications().catch(() => null),
          ]);
          // Don't overwrite notifications while the inbox is open — it would resurrect the just-cleared
          // unread badge (the optimistic read-all may not be committed server-side yet).
          const keepInbox = get().sheet === 'notifications' || !notifs;
          set({
            balanceUSD: bal,
            transactions: txns,
            requests: reqs,
            ...(keepInbox ? {} : { notifications: notifs.notifications, unread: notifs.unread }),
          });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      },
      // M6: mark the inbox read (optimistic; the next refresh reconciles).
      readNotifications: async () => {
        if (get().unread === 0) return;
        set((s) => ({ unread: 0, notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
        try {
          await api.readAllNotifications();
        } catch {
          /* best-effort */
        }
      },

      // ---- auth (delegates to the Privy bridge; signedIn is finalized by the bridge) ----
      setAuthBridge: (b) => set({ _authBridge: b }),
      onSignedIn: (walletAddress) => set({ walletAddress, authStatus: 'signedIn', authError: null }),
      requestOtp: async (email) => {
        set({ authError: null });
        try {
          await get()._authBridge?.sendCode(email);
          set({ authEmail: email, authStatus: 'codeSent' });
        } catch (e) {
          set({ authError: e instanceof Error ? e.message : String(e) });
        }
      },
      verifyOtp: async (code) => {
        set({ authError: null });
        try {
          await get()._authBridge?.verifyCode(code);
          // authStatus → 'signedIn' is set by the bridge once the embedded wallet is ready
        } catch (e) {
          set({ authError: e instanceof Error ? e.message : String(e) });
        }
      },
      logout: async () => {
        await get()._authBridge?.logout();
        setAuthToken(null);
        // Clear ALL persisted financial + identity data so the next person on this browser can't see the
        // prior user's balance / activity / handle / tier (these survive in localStorage via partialize).
        set({
          authStatus: 'signedOut',
          walletAddress: '',
          authEmail: '',
          handle: '',
          phone: '',
          country: '',
          evmDepositAddress: '',
          depositBalances: null,
          balanceUSD: 0,
          transactions: [],
          notifications: [],
          unread: 0,
          requests: [],
          kycTier: 1,
          recovered: false,
          recoveryPrompted: false,
          onboarded: false,
          firstLoadDone: false,
        });
      },
      // Dev-only full reset for re-testing onboarding + KYC from scratch. Order matters: reset the
      // BACKEND tier while still authed (logout clears the token next), then drop the KYC-redirect
      // stash, then logout (clears the Privy session + persisted store → onboarded=false, tier=1).
      resetForTesting: async () => {
        try {
          await api.devResetKyc();
        } catch {
          /* dev endpoint 403s in prod / no backend reachable — reset is best-effort */
        }
        try {
          sessionStorage.removeItem('fpay:resumePay');
        } catch {
          /* sessionStorage blocked — ignore */
        }
        await get().logout();
      },
      authSync: async (handle) => {
        // Browser-locale country guess — weakest source, server fills only when unset.
        // Deliberately no .maximize(): a bare "en" locale must send nothing, not US.
        let country: string | undefined;
        try {
          country = new Intl.Locale(navigator.language).region;
        } catch {
          /* no guess */
        }
        const me = await api.authSync({ handle, walletAddress: get().walletAddress, country });
        set({ walletAddress: me.walletAddress });
        await get().load();
      },

      // Decode a scanned QR and route: an fpay user's QR → real USDC send; a UPI/merchant QR →
      // the (Phase-2 mock) merchant pay flow; anything else → a friendly error on the Scan sheet.
      handleScan: async (text) => {
        const res = parseScannedQR(text);
        if (res.kind === 'handle') {
          if (res.handle === get().handle) {
            set({ error: "That's your own code" });
            return;
          }
          try {
            const friend = await wallet.resolveHandle(res.handle);
            if (!friend) {
              set({ error: `${res.handle} isn't on fpay yet` });
              return;
            }
            set({ error: null });
            get().setFriend(friend);
            get().open('sendAmount');
          } catch (e) {
            set({ error: e instanceof Error ? e.message : String(e) });
          }
        } else if (res.kind === 'upi') {
          // Merchant pay → the real order lifecycle: quote (rate+fee+ETA, 45s lock) → escrow → settle.
          set({ error: null });
          get().payMerchant({ name: res.name ?? res.payee ?? 'Merchant' }, res.amountInr ?? 0);
        } else if (res.kind === 'address') {
          set({ error: null });
          get().startExternalSend(res.address, res.network);
        } else if (res.kind === 'phone') {
          const candidates = phoneCandidates(res.number, {
            country: get().country || undefined,
            ownPhone: get().phone || undefined,
          });
          if (get().phone && candidates.includes(get().phone)) {
            set({ error: "That's your own number" });
            return;
          }
          try {
            let friend: Friend | null = null;
            for (const c of candidates) {
              friend = (await wallet.resolvePhone?.(c)) ?? null;
              if (friend) break;
            }
            if (!friend) {
              set({ error: "That number isn't on fpay yet" });
              return;
            }
            set({ error: null });
            get().setFriend(friend);
            get().open('sendAmount');
          } catch (e) {
            set({ error: e instanceof Error ? e.message : String(e) });
          }
        } else if (res.kind === 'unsupported') {
          set({ error: res.reason });
        } else {
          set({ error: 'Unrecognized QR' });
        }
      },

      // ---- direct send to a raw wallet address (docs/16) ----
      startExternalSend: (address, network) => {
        if (address === get().walletAddress) {
          set({ error: "That's your own wallet" });
          return;
        }
        const blank = { amountUsd: 0, feeUsd: 0, railFeeUsd: 0, totalFeeUsd: 0, etaSecs: 0 };
        if (network === 'evm') {
          // EVM family detected — the address is identical on every EVM chain, so the user picks
          // the network (live rails on top, coming-soon below).
          set({ externalSend: { address, network: 'evm', ...blank }, error: null });
          get().open('sendNetwork');
          return;
        }
        set({ externalSend: { address, network: 'solana', ...blank }, error: null });
        get().open('sendAddressAmount');
      },
      selectNetwork: (id) => {
        const ext = get().externalSend;
        if (!ext) return;
        set({ externalSend: { ...ext, network: id } });
        get().open('sendAddressAmount');
      },
      setExternalAmount: async (u) => {
        const ext = get().externalSend;
        if (!ext) return;
        let fees = { feeUsd: 0, railFeeUsd: 0, totalFeeUsd: 0, etaSecs: 0 };
        if (ext.network !== 'solana' && ext.network !== 'evm') {
          // Best-effort preview; /crosschain/prepare recomputes authoritatively at send time.
          try {
            const q = await api.crosschainQuote(ext.network, u);
            fees = { feeUsd: q.feeUsd, railFeeUsd: q.railFeeUsd, totalFeeUsd: q.totalFeeUsd, etaSecs: q.etaSecs };
          } catch {
            /* quote is display-only — confirm still shows the network without a fee row */
          }
        }
        set({ externalSend: { ...ext, amountUsd: u, ...fees } });
        get().open('sendAddressConfirm');
      },
      doSendExternal: async () => {
        const ext = get().externalSend;
        if (!ext || ext.amountUsd <= 0 || ext.network === 'evm') return null;
        set({ busy: true, error: null });
        try {
          let tx: Txn;
          if (ext.network === 'solana') {
            tx = await wallet.transfer({
              toAddress: ext.address,
              amountUsd: ext.amountUsd,
              idempotencyKey: crypto.randomUUID(),
            });
          } else {
            // Cross-chain: server builds the Solana burn (same signer as every send); the bridge
            // poller delivers on the destination. Blockhash retry reuses the key — the server
            // replays the same transfer with a fresh tx instead of double-sending.
            const idempotencyKey = crypto.randomUUID();
            const attempt = async (): Promise<string> => {
              const prep = await api.prepareCrosschain({
                network: ext.network,
                toAddress: ext.address,
                amountUsd: ext.amountUsd,
                idempotencyKey,
              });
              const signature = await getActiveSigner().signAndSend(prep.unsignedTx);
              await api.submitCrosschain({ transferId: prep.transferId, signature });
              return prep.transferId;
            };
            let transferId: string;
            try {
              transferId = await attempt();
            } catch (e) {
              if (/blockhash/i.test(e instanceof Error ? e.message : String(e))) transferId = await attempt();
              else throw e;
            }
            tx = {
              id: transferId,
              type: 'send',
              title: 'To ' + truncateAddress(ext.address),
              time: 'Just now',
              usd: -(ext.amountUsd + ext.totalFeeUsd),
              status: 'pending',
            };
          }
          const debit = ext.amountUsd + (ext.network === 'solana' ? 0 : ext.totalFeeUsd);
          set((s) => ({
            balanceUSD: +(s.balanceUSD - debit).toFixed(2),
            transactions: [tx, ...s.transactions],
            lastSend: { u: ext.amountUsd, handle: truncateAddress(ext.address) },
            externalSend: null,
            busy: false,
          }));
          get().open('sent');
          void get().refresh();
          [3000, 7000, 12000].forEach((ms) => setTimeout(() => void get().refresh(), ms));
          return tx;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'limit_exceeded') {
            set({ busy: false, error: 'Verify your identity to send to outside wallets.' });
            get().open('verify');
            return null;
          }
          const friendlyByCode: Record<string, string> = {
            invalid_recipient: 'That address can’t receive money. Double-check it.',
            self_send_not_allowed: "That's your own wallet",
            unsupported_network: 'fpay can’t send on that network yet.',
            amount_too_small: 'Sends to outside wallets need to be at least $1.',
            too_many_new_recipients: 'You’ve reached today’s limit for new wallets. Try tomorrow.',
            duplicate_request: 'That send is already in progress.',
            crosschain_unavailable: 'Sends to other networks are briefly unavailable. Try again soon.',
          };
          const friendly = e instanceof ApiError ? friendlyByCode[e.code] : undefined;
          set({ busy: false, error: friendly ?? (e instanceof Error ? e.message : String(e)) });
          get().open('sendFailed');
          return null;
        }
      },

      payMerchant: (m, rupees = 0) => {
        set({ merchant: m, scannedRupees: rupees });
        if (get().kycTier >= 2) {
          get().open('amount');
        } else {
          set({ pendingPay: true });
          get().open('verify');
        }
      },
      verifyDone: async () => {
        // Two providers behind one call (see backend /kyc/verify): the dev sim returns the new tier
        // instantly; a real vendor returns a hosted URL we navigate to (tier is raised later via the
        // webhook/reconciler, picked up by pollKyc when Didit redirects back to /home with
        // ?verificationSessionId=… appended). The callback carries NO query of our own, so Didit's
        // appended params can't collide with one (…/home?kyc=done?verificationSessionId=… would
        // otherwise mis-parse and skip the poll).
        try {
          set({ error: null });
          const r = await api.kycVerify(`${window.location.origin}/home`);
          if ('url' in r) {
            set({ kycStatus: 'pending' });
            // The redirect destroys in-memory state; stash the merchant-pay intent so we can resume
            // it when the user returns to /home (pollKyc reads this back).
            if (get().pendingPay) {
              try {
                sessionStorage.setItem(
                  'fpay:resumePay',
                  JSON.stringify({ merchant: get().merchant, rupees: get().scannedRupees }),
                );
              } catch {
                /* sessionStorage blocked — resume is best-effort */
              }
            }
            window.location.assign(r.url); // leaves the app; control returns via the callback URL
            return;
          }
          set({ kycTier: r.kycTier, kycStatus: 'approved' });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
          return;
        }
        if (get().pendingPay) {
          set({ pendingPay: false });
          get().open('amount');
        } else {
          get().close();
        }
      },
      pollKyc: async () => {
        // Poll /me until the vendor decision lands (the backend reconciler/webhook raises the tier).
        for (let i = 0; i < 20; i++) {
          try {
            const me = await api.me();
            set({ kycTier: me.kycTier, kycStatus: me.kycStatus ?? get().kycStatus });
            if (me.kycTier >= 2) {
              set({ pendingPay: false });
              get().resumePayAfterKyc();
              return;
            }
            if (me.kycStatus === 'declined') {
              set({ error: 'Verification didn’t pass. Please try again.' });
              return;
            }
          } catch {
            /* transient — keep trying */
          }
          await new Promise((res) => setTimeout(res, 3000));
        }
        // Timed out with no terminal decision — surface it instead of spinning forever.
        if (get().kycTier < 2) {
          set({ error: 'Verification is taking longer than expected. Please try again.' });
        }
      },
      resumePayAfterKyc: () => {
        // Resume a merchant-pay that was interrupted by the hosted-KYC redirect (see verifyDone).
        try {
          const raw = sessionStorage.getItem('fpay:resumePay');
          if (!raw) return;
          sessionStorage.removeItem('fpay:resumePay');
          const { merchant, rupees } = JSON.parse(raw) as { merchant: Merchant; rupees: number };
          set({ merchant, scannedRupees: rupees ?? 0 });
          get().open('amount');
        } catch {
          /* best-effort resume */
        }
      },
      recoveryDone: () => {
        set({ recovered: true });
        get().close();
      },
      setRecoveryStatus: ({ email, passkey }) => set({ recoveryEmail: email, recoveryPasskey: passkey }),

      // ---- pay-by-phone (enrolling IS the consent; the server reads the number from Privy) ----
      startPhoneLink: async (phoneNumber) => {
        if (USE_PRIVY) {
          await get()._authBridge?.sendPhoneCode(phoneNumber);
          return 'code_sent';
        }
        // Dev mode (no Privy): the backend dev shim accepts the number directly.
        const { phone } = await api.registerPhone(phoneNumber);
        set({ phone });
        const iso = isoFromE164(phone);
        if (iso) void get().setCountry(iso); // verified own number → authoritative dialing default
        return 'enrolled';
      },
      confirmPhoneLink: async (code) => {
        await get()._authBridge?.linkPhoneCode(code);
        const { phone } = await api.registerPhone(); // server pulls the now-linked number from Privy
        set({ phone });
        const iso = isoFromE164(phone);
        if (iso) void get().setCountry(iso);
      },
      disablePayByPhone: async () => {
        await api.deregisterPhone();
        set({ phone: '' });
      },
      setCountry: async (iso) => {
        if (!/^[A-Z]{2}$/.test(iso)) return;
        set({ country: iso }); // optimistic; /me reconciles
        try {
          await api.setCountry(iso);
        } catch {
          /* best-effort — a failed write leaves the previous server value until next load() */
        }
      },

      // ---- inbound cross-chain deposits (docs/19) ----
      setDepositBridge: (b) => set({ _depositBridge: b }),
      syncEvmAddress: async (address) => {
        const a = address.toLowerCase();
        if (get().evmDepositAddress === a) return;
        try {
          await api.setEvmAddress(a);
          set({ evmDepositAddress: a });
        } catch {
          /* best-effort; retried on next bridge mount */
        }
      },
      checkDeposits: async () => {
        set({ depositBusy: true });
        try {
          const { balances } = await api.depositBalances();
          set({ depositBalances: balances, depositBusy: false });
        } catch {
          set({ depositBalances: {}, depositBusy: false });
        }
      },
      doMoveToBalance: async (network) => {
        const amount = get().depositBalances?.[network] ?? 0;
        const bridge = get()._depositBridge;
        if (amount <= 0 || !bridge) return;
        set({ depositBusy: true, error: null });
        try {
          const prep = await api.depositPrepare({ sourceChain: network, amountUsd: amount });
          const txHash = await bridge.sendSponsoredCalls(prep.chainId, prep.calls);
          // The burn is real the moment it's signed — stash it so a crash before the report
          // can't lose the deposit (resumePendingDeposit re-reports on next open).
          const stash = { sourceChain: network, txHash, amountUsd: prep.burnAmountUsd };
          try {
            localStorage.setItem('fpay:pendingDeposit', JSON.stringify(stash));
          } catch {
            /* storage blocked — the report below almost always lands anyway */
          }
          await api.reportDeposit(stash);
          try {
            localStorage.removeItem('fpay:pendingDeposit');
          } catch {
            /* ignore */
          }
          set((s) => ({
            depositBusy: false,
            depositBalances: { ...(s.depositBalances ?? {}), [network]: 0 },
            transactions: [
              {
                id: txHash,
                type: 'add',
                title: 'Added money',
                time: 'Just now',
                usd: prep.burnAmountUsd,
                status: 'pending',
              },
              ...s.transactions,
            ],
          }));
          [5000, 15000, 40000].forEach((ms) => setTimeout(() => void get().refresh(), ms));
        } catch (e) {
          const friendly =
            e instanceof ApiError && e.code === 'crosschain_unavailable'
              ? 'Moving money is briefly unavailable. Try again soon.'
              : e instanceof Error
                ? e.message
                : String(e);
          set({ depositBusy: false, error: friendly });
        }
      },
      resumePendingDeposit: async () => {
        let stash: { sourceChain: string; txHash: string; amountUsd: number } | null = null;
        try {
          const raw = localStorage.getItem('fpay:pendingDeposit');
          stash = raw ? JSON.parse(raw) : null;
        } catch {
          return;
        }
        if (!stash) return;
        try {
          await api.reportDeposit(stash);
          localStorage.removeItem('fpay:pendingDeposit');
        } catch (e) {
          // Already reported → clear; anything else keeps the stash for the next open.
          if (e instanceof ApiError && e.code === 'duplicate_request') {
            try {
              localStorage.removeItem('fpay:pendingDeposit');
            } catch {
              /* ignore */
            }
          }
        }
      },
      addPasskey: async () => {
        const bridge = get()._authBridge;
        if (!bridge) {
          set({ authError: 'Sign in to set up recovery.' });
          return;
        }
        set({ authError: null });
        try {
          await bridge.linkPasskey();
          set({ recoveryPasskey: true, recovered: true });
        } catch (e) {
          set({ authError: e instanceof Error ? e.message : String(e) });
        }
      },
      finishPay: () => {
        if (!get().recovered && !get().recoveryPrompted) {
          set({ recoveryPrompted: true });
          get().open('recovery');
        } else {
          get().close();
        }
      },

      doSend: async (u) => {
        const { friend } = get();
        set({ busy: true, error: null });
        try {
          const tx = await wallet.transfer({ toHandle: friend.handle, amountUsd: u });
          set((s) => ({
            balanceUSD: +(s.balanceUSD - u).toFixed(2),
            transactions: [tx, ...s.transactions],
            lastSend: { u, handle: friend.handle },
            busy: false,
          }));
          get().open('sent');
          void get().refresh();
          // The web client doesn't watch the chain directly — poll a few times so the row
          // converges to the backend confirmer's confirmed/failed status.
          [3000, 7000, 12000].forEach((ms) => setTimeout(() => void get().refresh(), ms));
          return tx;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'limit_exceeded') {
            set({ busy: false, error: 'Verify your identity to raise your limit.' });
            get().open('verify');
            return null;
          }
          set({ busy: false, error: e instanceof Error ? e.message : String(e) });
          get().open('sendFailed');
          return null;
        }
      },

      // ---- order lifecycle: quote → confirm (sign escrow funding) → poll ----
      getQuote: async (rupees) => {
        set({ busy: true, error: null });
        try {
          const quote = await apiCreateQuote({ direction: 'spend', amountInr: rupees, payoutMethod: 'UPI' });
          set({ quote, payRupees: rupees, busy: false });
          get().open('quote');
        } catch (e) {
          if (e instanceof ApiError && e.code === 'limit_exceeded') {
            set({ busy: false, error: 'Verify your identity to raise your limit.', pendingPay: true });
            get().open('verify');
            return;
          }
          set({ busy: false, error: e instanceof Error ? e.message : String(e) });
        }
      },

      confirmOrder: async () => {
        const q = get().quote;
        if (!q) return;
        set({ busy: true, error: null });
        try {
          const order = await apiConfirmOrder(q.id);
          // Optimistically debit the escrowed USDC so a second order can't see the same balance;
          // refreshOrder() reconciles against the chain on completion/refund.
          set((s) => ({ order, balanceUSD: +(s.balanceUSD - q.amountUsdc).toFixed(2), busy: false }));
          get().open('tracking');
        } catch (e) {
          if (e instanceof ApiError && e.code === 'limit_exceeded') {
            set({ busy: false, error: 'Verify your identity to raise your limit.', pendingPay: true });
            get().open('verify');
            return;
          }
          set({ busy: false, error: e instanceof Error ? e.message : String(e) });
        }
      },

      refreshOrder: async () => {
        const current = get().order;
        if (!current) return;
        try {
          const order = await apiGetOrder(current.id);
          set({ order });
          // Once settled or refunded, reconcile the on-chain balance + activity.
          if (order.state === 'completed' || order.state === 'refunded') void get().refresh();
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      },

      editQuote: () => {
        set({ quote: null });
        get().open('amount');
      },

      // ---- payment requests ----
      requestMoney: async (handle, amountUsd, note) => {
        set({ busy: true, error: null });
        try {
          const r = await wallet.createRequest({ toHandle: handle, amountUsd, note });
          set((s) => ({
            requests: [r, ...s.requests],
            lastRequest: { u: amountUsd, handle },
            busy: false,
          }));
          get().open('requestSent');
        } catch (e) {
          set({ busy: false, error: e instanceof Error ? e.message : String(e) });
        }
      },

      // Pay an incoming request: send to the requester, then link the transfer to the request.
      payRequest: async (id) => {
        const r = get().requests.find((x) => x.id === id);
        if (!r?.counterpartyHandle) return;
        const handle = r.counterpartyHandle;
        get().setFriend({ name: handle, handle, ini: (handle.replace(/^@/, '')[0] ?? '?').toUpperCase() });
        const tx = await get().doSend(r.amountUsd);
        if (!tx) return; // doSend already set the error
        try {
          await wallet.payRequest(id, tx.id);
          set((s) => ({
            requests: s.requests.map((x) => (x.id === id ? { ...x, status: 'paid' } : x)),
          }));
          void get().refresh();
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      },

      cancelRequest: async (id) => {
        try {
          await wallet.cancelRequest(id);
          set((s) => ({
            requests: s.requests.map((x) => (x.id === id ? { ...x, status: 'cancelled' } : x)),
          }));
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      },

      doAdd: async (amt) => {
        // Mint test USDC to the user's wallet via the devnet faucet, then refresh.
        set({ busy: true, error: null });
        try {
          await wallet.addMoney?.(amt);
          get().close();
          await get().refresh();
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        } finally {
          set({ busy: false });
        }
      },

      completeOnboarding: () => set({ onboarded: true }),
    }),
    {
      name: 'pay-store',
      version: 1,
      // Migrate the old cosmetic `kyc: boolean` to the real `kycTier` (verified → tier 2).
      migrate: (persisted: unknown) => {
        const s = (persisted ?? {}) as Record<string, unknown>;
        if (typeof s.kycTier !== 'number') s.kycTier = s.kyc === true ? 2 : 1;
        delete s.kyc;
        return s as unknown as PayState;
      },
      // SSR-safe: localStorage in the browser, a no-op store during server render.
      storage: createJSONStorage(() =>
        typeof window !== 'undefined'
          ? window.localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      ),
      partialize: (s) => ({
        onboarded: s.onboarded,
        kycTier: s.kycTier,
        recovered: s.recovered,
        recoveryPrompted: s.recoveryPrompted,
        balanceUSD: s.balanceUSD,
        fxRate: s.fxRate,
        transactions: s.transactions,
        displayCurrency: s.displayCurrency,
        handle: s.handle,
      }),
    },
  ),
);

/** True once persisted state has been read from storage (re-renders on finish). Resolves true after
 *  a short timeout regardless, so a stalled hydration can never trap the entry page on the splash —
 *  proceeding with empty persisted state is the correct fallback (the app just redirects normally). */
export function useStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => usePayStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) {
      bootTrace('store hydrated (sync)');
      return;
    }
    const done = () => {
      bootTrace('store hydrated');
      setHydrated(true);
    };
    const unsub = usePayStore.persist.onFinishHydration(done);
    if (usePayStore.persist.hasHydrated()) done();
    const t = setTimeout(() => {
      bootTrace('store hydrate TIMEOUT — proceeding empty');
      setHydrated(true);
    }, 3000);
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, [hydrated]);
  return hydrated;
}
