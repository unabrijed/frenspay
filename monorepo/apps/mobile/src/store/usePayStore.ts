// usePayStore.ts — the single screen-state controller, ported from
// design-reference/app.jsx. balanceUSD is the source of truth; INR is always
// derived. Persisted fields survive reload (replaces the prototype's localStorage).
//
// Money flows delegate to the active WalletProvider (@/services/wallet): in mock mode
// that's local math (unchanged UX); in real mode (EXPO_PUBLIC_USE_REAL_API=1) it hits
// the Railway API + signs on-device. Real-only behaviors are gated on USE_REAL_API.
import type { ApiPaymentRequest } from '@pay/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { RATE } from '@/lib/money';
import { api, setAuthToken } from '@/services/api';
import { USE_PRIVY, USE_REAL_API } from '@/services/env';
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
  | 'recovery';

const SEED_TXNS: Txn[] = [
  { id: '1', type: 'pay', title: 'Anjuna Beach Cafe', time: 'Today · 09:24', usd: -5.71, rupees: 500 },
  { id: '2', type: 'send', title: 'To @neha', time: 'Yesterday', usd: -12.0 },
  { id: '3', type: 'add', title: 'Added money', time: '12 Jun', usd: 200.0 },
];

const SHEET_EXIT_MS = 280;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

let _seq = 0;
const localId = () => `local-${Date.now()}-${_seq++}`;

/** Imperative auth actions registered by the Privy bridge (real mode only). */
interface AuthBridge {
  sendCode: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface PayState {
  // ---- persisted ----
  onboarded: boolean;
  kyc: boolean;
  recovered: boolean;
  recoveryPrompted: boolean;
  balanceUSD: number;
  transactions: Txn[];

  // ---- ephemeral ----
  sheet: SheetId | null;
  closing: boolean;
  merchant: Merchant;
  friend: Friend;
  payRupees: number;
  detail: Txn | null;
  pendingPay: boolean;
  lastSend: { u: number; handle: string };
  lastRequest: { u: number; handle: string };
  requestDraftUsd: number;
  requests: ApiPaymentRequest[];
  busy: boolean;
  error: string | null;
  walletAddress: string;

  // ---- auth (Privy email OTP; real mode) ----
  authStatus: 'signedOut' | 'codeSent' | 'signedIn';
  authEmail: string;
  authError: string | null;
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
  payMerchant: (m: Merchant) => void;
  verifyDone: () => void;
  recoveryDone: () => void;
  finishPay: () => void;
  doPay: (ok: boolean) => void;
  doSend: (u: number) => Promise<Txn | null>;
  doAdd: (amt: number) => Promise<void>;

  // ---- onboarding ----
  completeOnboarding: () => void;
}

export const usePayStore = create<PayState>()(
  persist(
    (set, get) => ({
      onboarded: false,
      kyc: false,
      recovered: false,
      recoveryPrompted: false,
      balanceUSD: 420,
      transactions: SEED_TXNS,

      sheet: null,
      closing: false,
      merchant: { name: 'Anjuna Beach Cafe' },
      friend: FRIENDS[0],
      payRupees: 500,
      detail: null,
      pendingPay: false,
      lastSend: { u: 12, handle: '@neha' },
      lastRequest: { u: 20, handle: '@neha' },
      requestDraftUsd: 20,
      requests: [],
      busy: false,
      error: null,
      walletAddress: '',

      authStatus: 'signedOut',
      authEmail: '',
      authError: null,
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

      // Pull identity + balance + activity from the backend (no-op in mock mode).
      load: async () => {
        if (!USE_REAL_API) return;
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
        if (!USE_REAL_API) return;
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

      payMerchant: (m) => {
        set({ merchant: m });
        if (get().kyc) {
          get().open('amount');
        } else {
          set({ pendingPay: true });
          get().open('verify');
        }
      },
      verifyDone: () => {
        set({ kyc: true });
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
          if (USE_REAL_API) void get().refresh();
          return tx;
        } catch (e) {
          set({ busy: false, error: e instanceof Error ? e.message : String(e) });
          return null;
        }
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
          if (USE_REAL_API) void get().refresh();
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
        if (USE_REAL_API) {
          // Real: deposits arrive on-chain to the user's wallet; no instant credit.
          get().close();
          void get().refresh();
          return;
        }
        set((s) => ({
          balanceUSD: +(s.balanceUSD + amt).toFixed(2),
          transactions: [
            { id: localId(), type: 'add', title: 'Added money', time: 'Just now', usd: amt },
            ...s.transactions,
          ],
        }));
        get().close();
      },

      completeOnboarding: () => set({ onboarded: true }),
    }),
    {
      name: 'pay-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        onboarded: s.onboarded,
        kyc: s.kyc,
        recovered: s.recovered,
        recoveryPrompted: s.recoveryPrompted,
        balanceUSD: s.balanceUSD,
        transactions: s.transactions,
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
