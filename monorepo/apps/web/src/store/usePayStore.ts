// usePayStore.ts — the single screen-state controller, ported from
// design-reference/app.jsx. balanceUSD is the source of truth; INR is always
// derived. Persisted fields survive reload (replaces the prototype's localStorage).
//
// Money flows delegate to the RealWalletProvider (@/services/wallet) → the backend API + on-device
// signing. The app is always real; balance/activity load from the backend once signed in.
import type { ApiPaymentRequest, Order, Quote } from '@pay/shared';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { RATE } from '@/lib/money';
import type { DisplayCurrency } from '@/lib/money';
import { parseScannedQR } from '@/lib/qr';
import { api, ApiError, setAuthToken } from '@/services/api';
import { USE_PRIVY } from '@/services/env';
import { confirmOrder as apiConfirmOrder, createQuote as apiCreateQuote, getOrder as apiGetOrder } from '@/services/orders';
import { FRIENDS, wallet, type Friend, type Merchant, type Txn } from '@/services/wallet';

export type SheetId =
  | 'scan'
  | 'amount'
  | 'review'
  | 'success'
  | 'declined'
  | 'add'
  | 'send'
  | 'sendAmount'
  | 'request'
  | 'requestPick'
  | 'requestSent'
  | 'sent'
  | 'verify'
  | 'recovery'
  | 'receive'
  | 'currency'
  | 'quote'
  | 'tracking';

const SHEET_EXIT_MS = 280;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

let _seq = 0;
const localId = () => `local-${Date.now()}-${_seq++}`;

/** Imperative auth actions registered by the Privy bridge (real mode only). */
interface AuthBridge {
  sendCode: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Link a passkey to the Privy user — a cross-device recovery factor. */
  linkPasskey: () => Promise<void>;
}

interface PayState {
  // ---- persisted ----
  onboarded: boolean;
  kycTier: number;
  recovered: boolean;
  recoveryPrompted: boolean;
  balanceUSD: number;
  transactions: Txn[];
  displayCurrency: DisplayCurrency;
  handle: string;

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
  lastSend: { u: number; handle: string };
  lastRequest: { u: number; handle: string };
  requestDraftUsd: number;
  requests: ApiPaymentRequest[];
  busy: boolean;
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

  // ---- flows (mirror app.jsx) ----
  /** Decode a scanned QR and route to the right flow (send / merchant-pay). */
  handleScan: (text: string) => Promise<void>;
  payMerchant: (m: Merchant, rupees?: number) => void;
  verifyDone: () => void;
  recoveryDone: () => void;
  /** Publish real recovery status from the Privy bridge. */
  setRecoveryStatus: (s: { email: string; passkey: boolean }) => void;
  /** Link a passkey as a second-device recovery factor (delegates to Privy). */
  addPasskey: () => Promise<void>;
  finishPay: () => void;
  doPay: (ok: boolean) => void;
  doSend: (u: number) => Promise<Txn | null>;
  doAdd: (amt: number) => Promise<void>;

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
      transactions: [],
      displayCurrency: 'INR',
      handle: '',

      sheet: null,
      closing: false,
      merchant: { name: 'Anjuna Beach Cafe' },
      friend: FRIENDS[0],
      payRupees: 500,
      scannedRupees: 0,
      detail: null,
      pendingPay: false,
      lastSend: { u: 12, handle: '@neha' },
      lastRequest: { u: 20, handle: '@neha' },
      requestDraftUsd: 20,
      requests: [],
      busy: false,
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
        set({ busy: true, error: null });
        try {
          const [me, bal, txns, reqs] = await Promise.all([
            api.me(),
            wallet.getBalanceUsd(),
            wallet.getTransactions(),
            wallet.getRequests(),
          ]);
          set({
            walletAddress: me.walletAddress,
            handle: me.handle,
            kycTier: me.kycTier,
            balanceUSD: bal,
            transactions: txns,
            requests: reqs,
            busy: false,
          });
        } catch (e) {
          set({ busy: false, error: e instanceof Error ? e.message : String(e) });
        }
      },
      refresh: async () => {
        try {
          const [bal, txns, reqs] = await Promise.all([
            wallet.getBalanceUsd(),
            wallet.getTransactions(),
            wallet.getRequests(),
          ]);
          set({ balanceUSD: bal, transactions: txns, requests: reqs });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
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
        set({ authStatus: 'signedOut', walletAddress: '', authEmail: '' });
      },
      authSync: async (handle) => {
        const me = await api.authSync({ handle, walletAddress: get().walletAddress });
        set({ walletAddress: me.walletAddress });
        await get().load();
      },

      // Decode a scanned QR and route: a Pay user's QR → real USDC send; a UPI/merchant QR →
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
              set({ error: `${res.handle} isn't on Pay yet` });
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
          set({ error: 'That wallet isn’t a Pay user yet — ask them to join Pay.' });
        } else {
          set({ error: 'Unrecognized QR' });
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
        // Simulated KYC upgrade — promotes the tier server-side (unlocks merchant pay at tier 2).
        try {
          const r = await api.kycVerify();
          set({ kycTier: r.kycTier });
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
      recoveryDone: () => {
        set({ recovered: true });
        get().close();
      },
      setRecoveryStatus: ({ email, passkey }) => set({ recoveryEmail: email, recoveryPasskey: passkey }),
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

      // Merchant pay stays on the mock settlement path (Phase 2).
      doPay: (ok) => {
        if (!ok) {
          get().open('declined');
          return;
        }
        const { payRupees, merchant } = get();
        const u = payRupees / RATE;
        set((s) => ({
          balanceUSD: +(s.balanceUSD - u).toFixed(2),
          transactions: [
            { id: localId(), type: 'pay', title: merchant.name, time: 'Just now', usd: -u, rupees: payRupees },
            ...s.transactions,
          ],
        }));
        get().open('success');
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
        transactions: s.transactions,
        displayCurrency: s.displayCurrency,
        handle: s.handle,
      }),
    },
  ),
);

/** True once persisted state has been read from AsyncStorage (re-renders on finish). */
export function useStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => usePayStore.persist.hasHydrated());
  useEffect(() => {
    const unsub = usePayStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(usePayStore.persist.hasHydrated());
    return unsub;
  }, []);
  return hydrated;
}
