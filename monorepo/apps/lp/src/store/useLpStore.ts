'use client';

// useLpStore — the LP console's state. Small on purpose.
//
// The wallet app's store is ~1400 lines because it owns sheets, money, contacts, requests,
// notifications and currency prefs. This console needs six facts and three actions, and porting the
// payer store would have brought a `load()` that fans out to five endpoints the LP has no use for.
//
// Everything here comes from `GET /me` plus one balance call. The merchant profile rides on /me
// already (it is the whole merchant-role signal), so there is no separate merchant fetch.
import type { MeResponse, MerchantProfile } from '@fpay/shared';
import { create } from 'zustand';

import { req } from '@/services/api';

/** Imperative auth actions the Dynamic bridge registers, so screens never import Dynamic. */
export interface AuthBridge {
  sendCode: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  logout: () => Promise<void>;
}

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface Toast {
  id: number;
  msg: string;
  tone: 'success' | 'error';
}

interface LpState {
  authStatus: AuthStatus;
  /** Set once Dynamic has an embedded wallet — the address the LP signs and stakes from. */
  walletAddress: string;
  /** True once /me has answered at least once, so screens can tell "loading" from "nothing". */
  loaded: boolean;
  /** The backend confirmed this session has no fpay account here yet. AuthGate's FinishSetup makes
   *  one (or adopts one) through /auth/sync; a good load() clears this. */
  noAccount: boolean;
  suspended: boolean;

  kycTier: number;
  kycStatus: MeResponse['kycStatus'];
  /** Is the identity vendor switched on for this deployment? Defaults true so a backend that doesn't
   *  send the flag behaves exactly as before. False ⇒ the reviewer is the identity check (docs/14). */
  identityCheckAvailable: boolean;
  merchant: MerchantProfile | null;
  balanceUSD: number;

  toast: Toast | null;
  auth: AuthBridge | null;

  setAuthBridge: (b: AuthBridge | null) => void;
  onSignedIn: (address: string) => void;
  onSignedOut: () => void;
  load: () => Promise<void>;
  notify: (msg: string, tone?: Toast['tone']) => void;
  /** Poll /me until the KYC tier lands after the vendor redirect returns. */
  pollKyc: () => Promise<void>;
}

const TOAST_MS = 3500;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** KYC polling after the hosted redirect: the vendor's webhook and our poller race the user's
 *  return, so the tier can land a few seconds late. 20 × 3s, then give up quietly. */
const KYC_POLL_TRIES = 20;
const KYC_POLL_MS = 3000;

export const useLpStore = create<LpState>((set, get) => ({
  authStatus: 'loading',
  walletAddress: '',
  loaded: false,
  noAccount: false,
  suspended: false,
  kycTier: 0,
  kycStatus: undefined,
  identityCheckAvailable: true,
  merchant: null,
  balanceUSD: 0,
  toast: null,
  auth: null,

  setAuthBridge: (b) => set({ auth: b }),

  onSignedIn: (address) => set({ authStatus: 'signedIn', walletAddress: address }),
  onSignedOut: () =>
    set({
      authStatus: 'signedOut',
      walletAddress: '',
      loaded: false,
      noAccount: false,
      suspended: false,
      merchant: null,
      kycTier: 0,
      balanceUSD: 0,
    }),

  /**
   * One read of who this LP is. `/me` carries the merchant profile, the KYC tier and the wallet;
   * the balance is a second call only because staking needs to know what they can afford.
   *
   * A failed balance must not blank the console — the merchant profile is the screen, and an LP
   * looking at an order they have to pay in four minutes should not lose it to an RPC hiccup.
   */
  load: async () => {
    // Both in flight at once; the balance is read after /me has landed so its failure stays its own.
    const balance = req<{ balanceUsd: string }>('/balance');
    try {
      const me = await req<MeResponse>('/me');
      set({
        loaded: true,
        noAccount: false,
        kycTier: me.kycTier,
        kycStatus: me.kycStatus,
        identityCheckAvailable: me.identityCheckAvailable ?? true,
        merchant: me.merchant ?? null,
        walletAddress: me.walletAddress || get().walletAddress,
      });
    } catch {
      // setSessionRevokedHandler already flips `noAccount` for the one error that means it; any
      // other failure leaves the last-known state alone rather than emptying the screen.
      set({ loaded: true });
      balance.catch(() => {}); // nothing to show it on
      return;
    }
    try {
      const bal = await balance;
      set({ balanceUSD: Number(bal.balanceUsd) });
    } catch {
      /* balance is context, never the point */
    }
  },

  notify: (msg, tone = 'success') => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), msg, tone } });
    toastTimer = setTimeout(() => set({ toast: null }), TOAST_MS);
  },

  pollKyc: async () => {
    for (let i = 0; i < KYC_POLL_TRIES; i += 1) {
      await new Promise((r) => setTimeout(r, KYC_POLL_MS));
      await get().load();
      if (get().kycTier >= 2) return;
    }
  },
}));
