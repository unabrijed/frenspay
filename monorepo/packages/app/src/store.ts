// usePayStore.ts — the single screen-state controller, ported from
// design-reference/app.jsx. balanceUSD is the source of truth; INR is always
// derived. Persisted fields survive reload (replaces the prototype's localStorage).
//
// Money flows delegate to the RealWalletProvider (@/services/wallet) → the backend API + on-device
// signing. The app is always real; balance/activity load from the backend once signed in.
import { type ApiPaymentRequest, classifyPayTarget, countryFromTimeZone, currencyForCountry, type DisplayCurrency, fiatDecimals, isDisplayCurrency, isoFromE164, type KycStatus, type NetworkId, type Notification, type Order, phoneCandidates, type Quote, truncateAddress } from '@fpay/shared';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { friendlyError } from './lib/errors';
import { api, ApiError, setAuthToken } from './services/api';
import { getActiveSigner } from './services/signer';
import { platform } from './platform';
import { confirmOrder as apiConfirmOrder, createQuote as apiCreateQuote, getOrder as apiGetOrder } from './services/orders';
import { wallet, type Friend, type Payee, type Txn } from './services/wallet';

// In-flight guard for the silent background re-quote (see refreshQuote).
let refreshingQuote = false;

// Same guard for the two data-fetching entry points. Cold boot fires load() (PrivyBridge, on token)
// and refresh() (useLiveSync, on mount) at the same instant, StrictMode double-mounts the second,
// and the fund step prefetches a third — five overlapping copies of the SAME six calls. Guarding
// here rather than at each call site is the point: every path routes through these two, and the
// burst is what tipped the Solana RPC into throttling, which is what /balance 500s were.
// refresh() also stands down for an in-flight load(), which fetches a superset — never the reverse,
// because load() commits identity (onboarded/provisioned) that refresh() does not.
let loading = false;
let refreshing = false;

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
  | 'localCurrency'
  | 'country'
  | 'quote'
  | 'tracking'
  | 'help'
  | 'notifications';

const SHEET_EXIT_MS = 280;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const TOAST_MS = 3500;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastSeq = 0;

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
  /** How many invite codes I own + how many have been burned. Server truth via /me. */
  invitesTotal: number;
  invitesUsed: number;
  /** The code strings — populated by /me ONLY until the reveal screen is acknowledged, then empty
   *  forever. Never persisted: putting them in localStorage would quietly undo "one look". */
  invites: string[];
  recovered: boolean;
  recoveryPrompted: boolean;
  balanceUSD: number;
  fxRate: number; // live INR-per-USD mid rate (M7), for standalone INR display
  /** Live mid rates per corridor currency — what the pay keypad estimates in. `fxRate` stays the
   *  INR alias for the P2P/display-preference sites, which are INR-corridor UX today. */
  fxRates: Record<string, number>;
  transactions: Txn[];
  notifications: Notification[];
  unread: number;
  displayCurrency: DisplayCurrency;
  /** Pinned local (second-line) currency — null = automatic, derived from `country`. Server truth
   *  via /me (users.local_currency); persisted here only as a cache. */
  localCurrency: string | null;
  /** Which balance currency is written big: false = preferred on top. Ephemeral by design — a
   *  glance-order choice, not a setting (docs/05). */
  flipped: boolean;
  /** The eye: masks every balance and transaction amount. Persisted CLIENT-side only — privacy of
   *  this screen in this pocket; deliberately not synced, unlike the currency prefs (docs/05). */
  hideAmounts: boolean;
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
  /** The shop/person being paid — from a scanned UPI QR. NOT the LP that settles it. */
  payee: Payee;
  friend: Friend;
  payRupees: number;
  /** Rupee amount carried in from a scanned (dynamic) UPI QR; 0 = enter manually. */
  scannedRupees: number;
  detail: Txn | null;
  pendingPay: boolean;
  /** Real-vendor verification lifecycle (M7): 'pending' while the user is in/returning from the flow. */
  kycStatus: KycStatus;
  /** Coarse role from /me — gates the Settings → Admin link ('merchant' is informational). */
  role: 'user' | 'merchant' | 'admin';
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
  /** True once /auth/sync has provisioned the backend user for this SESSION. Ephemeral (never
   *  persisted); combined with the persisted `onboarded` it gates data fetches so an onboarding user
   *  who is signed in with Privy but not yet synced doesn't fire (and 401) /balance etc. */
  provisioned: boolean;
  /** Admin froze the account (backend 403 account_suspended on any call). Ephemeral: re-derived
   *  every session — set by the api-layer hook, cleared by the next successful load()/refresh(),
   *  so a reinstated account heals itself on its next poll. Renders SuspendedGate full-screen. */
  suspended: boolean;
  /** Admin soft-deleted the account (403 account_deleted). Ephemeral, same seam as `suspended` —
   *  distinct because the screen is different: deleted ≠ paused, and funds stay reachable via Privy. */
  deleted: boolean;
  error: string | null;
  /** Transient snackbar (money-app toast). Shown by ToastHost, set via notify(), auto-clears. */
  toast: { id: number; msg: string; tone: 'error' | 'success' } | null;
  walletAddress: string;
  // ---- M1 order lifecycle (quote engine + order state machine) ----
  quote: Quote | null;
  order: Order | null;

  // ---- auth (Privy email OTP; real mode) ----
  /** Privy has finished restoring (or failing to restore) a session — published by the bridge from
   *  its `ready`. Until then `authStatus: 'signedOut'` is a NOT-YET, not a no, and routing on it
   *  dumped a signed-in returning user on the marketing welcome screen before the bridge could
   *  correct it. Ephemeral by definition. */
  authReady: boolean;
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
  /** Show a transient snackbar. Default tone is 'error'; auto-dismisses. */
  notify: (msg: string, tone?: 'error' | 'success') => void;

  // ---- in-flight context ----
  setFriend: (f: Friend) => void;
  setPayRupees: (r: number) => void;
  setRequestDraft: (u: number) => void;
  openDetail: (tx: Txn) => void;
  setDisplayCurrency: (c: DisplayCurrency) => Promise<void>;
  setLocalCurrency: (c: string | null) => Promise<void>;
  toggleFlip: () => void;
  toggleHideAmounts: () => void;

  // ---- backend sync (real mode only) ----
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Pull the mid rates this client needs — derived from the live rails and this user's country,
   *  never a hardcoded list. Never throws; an unpriceable currency is simply left absent. */
  syncRates: (extra?: string) => Promise<void>;
  readNotifications: () => Promise<void>;

  // ---- payment requests ----
  requestMoney: (handle: string, amountUsd: number, note?: string) => Promise<void>;
  payRequest: (id: string) => Promise<void>;
  cancelRequest: (id: string) => Promise<void>;

  // ---- auth actions (delegate to the Privy bridge) ----
  setAuthBridge: (b: AuthBridge) => void;
  /** Privy's `ready` — see `authReady`. Called by the bridge, never by a screen. */
  setAuthReady: () => void;
  onSignedIn: (walletAddress: string) => void;
  requestOtp: (email: string) => Promise<void>;
  verifyOtp: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  authSync: (handle: string, inviteCode?: string) => Promise<void>;
  /** Tell the server the codes have been seen, then drop them locally. One-way. */
  acknowledgeInvites: () => Promise<void>;
  /** Dev-only: reset backend KYC tier + local state and sign out, to re-test onboarding + KYC. */
  resetForTesting: () => Promise<void>;

  // ---- flows (mirror app.jsx) ----
  /** Decode a scanned QR and route to the right flow (send / merchant-pay). */
  handleScan: (text: string) => Promise<void>;
  payPayee: (p: Payee, rupees?: number) => void;
  verifyDone: () => void;
  /** After returning from the hosted KYC flow: poll /me until the vendor decision lands. */
  pollKyc: () => Promise<void>;
  /** Resume a merchant-pay interrupted by the hosted-KYC redirect (reads the sessionStorage stash). */
  resumePayAfterKyc: () => Promise<void>;
  recoveryDone: () => void;
  /** Publish real recovery status from the Privy bridge. */
  setRecoveryStatus: (s: { email: string; passkey: boolean }) => void;
  // ---- pay-by-phone (UPI-mapper consent model: enrolling IS the consent) ----
  /** Step 1: send the SMS code via Privy. Dev mode (no Privy) enrolls directly. */
  startPhoneLink: (phoneNumber: string) => Promise<void>;
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
  /** Silently re-quote the same rupee amount when the held rate nears expiry. No busy/sheet/error. */
  refreshQuote: () => Promise<void>;
  /** Confirm the live quote: create the order, sign the escrow funding, open the timeline. */
  confirmOrder: () => Promise<void>;
  /** Poll the in-flight order; refreshes balance once it reaches a terminal state. */
  refreshOrder: () => Promise<void>;
  /** Payer reports the money never arrived, while the merchant's release window is still open. */
  disputeOrder: (reason?: string, orderId?: string) => Promise<void>;
  feedbackOrder: (up: boolean) => Promise<void>;
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
      invitesTotal: 3,
      invitesUsed: 0,
      invites: [],
      recovered: false,
      recoveryPrompted: false,
      balanceUSD: 0,
      fxRate: 87.55,
      fxRates: { INR: 87.55, IDR: 16_500 },
      transactions: [],
      notifications: [],
      unread: 0,
      // Dollars by default: the balance IS dollars, and the local currency now appears beneath it
      // on its own (useBalanceDisplay), so leading in a corridor currency would show a conversion
      // where the actual figure belongs — and showed the same number twice for Indian users.
      displayCurrency: 'USD',
      localCurrency: null,
      flipped: false,
      hideAmounts: false,
      handle: '',
      phone: '',
      country: '',
      evmDepositAddress: '',
      depositBalances: null,
      depositBusy: false,

      sheet: null,
      closing: false,
      // Empty, not a plausible demo value. Every sheet that reads these is opened by the same set()
      // that writes the real ones, so a seed is never SUPPOSED to render — which is exactly why a
      // realistic one is dangerous: the day some path opens a sheet without writing first, the
      // screen states a payment that did not happen instead of showing an obvious blank. Same
      // reason Settings no longer says '@you'. `friend` was already written this way.
      payee: { name: '' },
      friend: { name: '', handle: '', ini: '' },
      payRupees: 500,
      scannedRupees: 0,
      detail: null,
      pendingPay: false,
      kycStatus: 'none',
      role: 'user',
      externalSend: null,
      lastSend: { u: 0, handle: '' },
      lastRequest: { u: 0, handle: '' },
      requestDraftUsd: 20,
      requests: [],
      busy: false,
      firstLoadDone: false,
      provisioned: false,
      suspended: false,
      deleted: false,
      error: null,
      toast: null,
      walletAddress: '',
      quote: null,
      order: null,

      // Dev mode (no Privy) has nothing to wait for — the x-dev-user-id header is always ready.
      authReady: false, // configure() flips it for the dev-signer path; the Privy bridge otherwise
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
      notify: (msg, tone = 'error') => {
        const id = ++toastSeq;
        set({ toast: { id, msg, tone } });
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          // Only clear if this toast is still the current one (a newer notify() supersedes it).
          if (get().toast?.id === id) set({ toast: null });
          toastTimer = null;
        }, TOAST_MS);
      },

      setFriend: (f) => set({ friend: f }),
      setPayRupees: (r) => set({ payRupees: r }),
      setRequestDraft: (u) => set({ requestDraftUsd: u }),
      openDetail: (tx) => set({ detail: tx }),
      // Optimistic like setCountry: set() paints immediately, the server write is best-effort —
      // a failure leaves the local choice standing and the next load() reconciles to server truth.
      setDisplayCurrency: async (c) => {
        set({ displayCurrency: c });
        try {
          await api.setPreferredCurrency(c);
        } catch {
          /* best-effort */
        }
      },
      setLocalCurrency: async (c) => {
        set({ localCurrency: c });
        try {
          await api.setLocalCurrency(c);
        } catch {
          /* best-effort */
        }
      },
      toggleFlip: () => set((s) => ({ flipped: !s.flipped })),
      toggleHideAmounts: () => set((s) => ({ hideAmounts: !s.hideAmounts })),

      // Pull identity + balance + activity from the backend. Also THE account probe: /me is the only
      // thing that knows whether this Privy identity owns an account, so signing in always asks.
      //
      // This used to additionally require `provisioned || onboarded` — both localStorage-backed — so
      // a returning user on a browser that had never seen them (signed out and back in, new device,
      // incognito, cleared storage) never got to ask. `handle` stayed '' and the boot router sent
      // them to "Choose your handle" for an account they already had. A browser cannot answer that
      // question; only the server can. Same posture as apps/admin and apps/lp, which already probe
      // unconditionally and treat 401/404 as "no account".
      load: async () => {
        // Pre-sign-in only. Leave firstLoadDone false so the splash stays until Privy resolves.
        if (platform().env.usePrivy && get().authStatus !== 'signedIn') return;
        // A concurrent duplicate is dropped, not queued: the one already running lands the same
        // data into the same store. Every caller fire-and-forgets (`void load()`), so nothing is
        // waiting on this promise for a result.
        if (loading) return;
        loading = true;
        // First load of this session: drop any persisted prior-session financials so they can't flash
        // before the fresh fetch resolves. Skeletons (gated on firstLoadDone) cover the gap. Identity
        // (handle/kycTier) is left intact — load() repopulates it and losing it would break routing.
        if (!get().firstLoadDone) {
          set({ balanceUSD: 0, transactions: [], requests: [], notifications: [], unread: 0 });
        }
        set({ busy: true, error: null });
        try {
          // The probe goes FIRST and ALONE. It used to ride in the Promise.all below, which meant
          // the identity answer was decided by whichever call rejected first — so one flaky
          // /balance on a returning user's cold load looked identical to "no account", and routed
          // them to pick a handle they already had. /me is the only call that can answer this, so
          // it is the only one allowed to. One extra round trip, on cold boot, behind skeletons.
          const me = await api.me();
          // Committed the moment identity is known, BEFORE the money calls — they are allowed to
          // fail, and this is not. Landing `onboarded` in the same set() as the balance would have
          // meant a 500 on /transactions leaves a real account still looking unregistered, which is
          // the same dead end by a different route.
          set({
            walletAddress: me.walletAddress,
            handle: me.handle,
            phone: me.phone ?? '',
            country: me.country ?? '',
            // Server truth wins when set; a not-a-display-currency value (stale corridor) is ignored.
            ...(me.preferredCurrency && isDisplayCurrency(me.preferredCurrency)
              ? { displayCurrency: me.preferredCurrency }
              : {}),
            localCurrency: me.localCurrency ?? null,
            evmDepositAddress: me.evmDepositAddress ?? '',
            kycTier: me.kycTier,
            kycStatus: me.kycStatus ?? 'none',
            invitesTotal: me.invitesTotal ?? 0,
            invitesUsed: me.invitesUsed ?? 0,
            // Absent once acknowledged — the server stops sending them, so this goes back to [].
            invites: me.invites ?? [],
            role: me.role ?? 'user',
            suspended: false,
            deleted: false,
            // /me answered, so the account exists — server truth, replacing whatever this browser
            // did or didn't remember. Both flags are what every downstream guard reads (the tabs
            // layout, the boot router, refresh()).
            onboarded: true,
            provisioned: true,
          });
          // AFTER the set above, because which rates we want depends on `country`, which arrives
          // with `me` and is not persisted. Not awaited: the balance paints at the seeded/persisted
          // rate and the local line settles a moment later, rather than the whole dashboard waiting
          // on FX.
          void get().syncRates();
          void get().resumePendingDeposit(); // lost-burn-hash recovery (docs/19 inbound)
          // Each money call keeps its own footing. In one bare Promise.all the first rejection took
          // the other two down and dropped the whole load into the catch below — so a single 503
          // from /balance (RPC throttled) blanked activity and requests too, on an account whose
          // identity had just resolved fine. The comment above is only true if they fail alone.
          // Balance holds its previous figure rather than falling to 0: this is the number people
          // read as "my money", and inventing a zero for it is worse than showing a stale one.
          // ponytail: on a COLD load there is no previous figure (the reset above zeroed it), so the
          // fallback below still paints $0 for one poll cycle — a toast now says so rather than
          // letting that zero read as fact. Removing the zero entirely means a nullable balanceUSD
          // threaded through every consumer; do that if "stale" and "unknown" ever need to look
          // different on screen.
          const [bal, txns, reqs, notifs] = await Promise.all([
            wallet.getBalanceUsd().catch((e) => {
              // A warm refresh holds the last figure silently — it's real, just stale. A cold load
              // has no last figure, so the same fallback would present a made-up $0 as this
              // account's money. firstLoadDone is still false here (set below, after this await),
              // which is exactly the cold-load signal.
              if (!get().firstLoadDone) get().notify(friendlyError(e));
              return get().balanceUSD;
            }),
            wallet.getTransactions().catch(() => get().transactions),
            wallet.getRequests().catch(() => get().requests),
            // Non-critical: a failing /notifications must never blank the dashboard.
            api.getNotifications().catch(() => ({ notifications: get().notifications, unread: get().unread })),
          ]);
          set({
            balanceUSD: bal,
            transactions: txns,
            requests: reqs,
            notifications: notifs.notifications,
            unread: notifs.unread,
            busy: false,
            firstLoadDone: true,
          });
        } catch (e) {
          // The probe's OTHER valid answer: this identity genuinely has no account yet (pre
          // /auth/sync onboarding, or a signed-in session on an environment where the row doesn't
          // exist). Not an error to show anyone — it's how a new user is recognised. firstLoadDone
          // still flips so the boot router stops holding the splash and routes to the handle step.
          if (e instanceof ApiError && e.code === 'no_account') {
            // Drop any remembered handle with it: the server just said this identity owns nothing,
            // so a persisted one is stale (a deleted account, or storage from a different
            // environment) and would resume onboarding at the wrong step.
            set({ busy: false, firstLoadDone: true, handle: '' });
            return;
          }
          // Mark firstLoadDone even on failure so skeletons resolve to the empty/error state
          // rather than spinning forever.
          set({ busy: false, firstLoadDone: true, error: e instanceof Error ? e.message : String(e) });
        } finally {
          loading = false;
        }
      },
      refresh: async () => {
        // Same gate as load(): never poll before the backend user exists (onboarding pre-sync → 401).
        if (platform().env.usePrivy && !(get().authStatus === 'signedIn' && (get().provisioned || get().onboarded))) return;
        // Stand down for a cold load() as well as a sibling refresh() — see the flags' declaration.
        if (loading || refreshing) return;
        refreshing = true;
        try {
          // Rates ride along on every poll, not just load(): a session left open all day kept its
          // boot-time rate and every converted line drifted from the quote the backend would
          // actually return. /me rides along too — identity is admin-mutable now (docs/24), and
          // without it an open tab served a renamed user's OLD handle in the Receive QR forever
          // (load() only runs on cold sign-in). Also how suspension/reinstatement reaches an open
          // tab within one poll.
          const [me, bal, txns, reqs, notifs] = await Promise.all([
            api.me(),
            wallet.getBalanceUsd(),
            wallet.getTransactions(),
            wallet.getRequests(),
            api.getNotifications().catch(() => null),
            get().syncRates(),
          ]);
          // Don't overwrite notifications while the inbox is open — it would resurrect the just-cleared
          // unread badge (the optimistic read-all may not be committed server-side yet).
          const keepInbox = get().sheet === 'notifications' || !notifs;
          set({
            handle: me.handle,
            role: me.role ?? 'user',
            kycTier: me.kycTier,
            kycStatus: me.kycStatus ?? 'none',
            ...(me.preferredCurrency && isDisplayCurrency(me.preferredCurrency)
              ? { displayCurrency: me.preferredCurrency }
              : {}),
            localCurrency: me.localCurrency ?? null,
            suspended: false,
            deleted: false,
            balanceUSD: bal,
            transactions: txns,
            requests: reqs,
            ...(keepInbox ? {} : { notifications: notifs.notifications, unread: notifs.unread }),
          });
        } catch {
          // Background poll — stay quiet; the next tick recovers. Don't pollute the shared error slot
          // or spam a toast every interval. User-initiated actions surface their own errors.
        } finally {
          refreshing = false;
        }
      },
      syncRates: async (extra) => {
        // Only what this client will actually write: the currency they read in, and the one their
        // balance's second line is in (pinned, else derived from their country). `extra` is the
        // scanned rail's currency — fetched at scan time (payPayee) rather than kept warm for a
        // corridor they may never touch. This used to prefetch every LIVE rail's currency, which
        // meant an Indian user pulling IDR on every poll for a QRIS code they'd never scan.
        //
        // isDisplayCurrency is the gate for "can we price this at all": anything else has no FX
        // band on the backend, so asking 400s. That is how someone whose country is Britain used
        // to fire a doomed GBP call on every single refresh tick.
        const s = get();
        const wanted = [...new Set([s.displayCurrency, s.localCurrency || currencyForCountry(s.country), extra])].filter(
          (c): c is string => !!c && c !== 'USD' && isDisplayCurrency(c),
        );

        const got = await Promise.all(
          // A currency with no FX band 4xx's — that is not an error, it is the answer. Leaving it
          // absent from fxRates is precisely what makes the balance fall back to dollars, so a
          // placeholder rate here would defeat the whole rule.
          wanted.map((c) => api.fxRate(c).then((r) => [c, r.rate] as const).catch(() => null)),
        );
        const next = { ...get().fxRates };
        for (const pair of got) if (pair) next[pair[0]] = pair[1];
        // `fxRate` is the INR-only scalar the send/request sheets still read; keep it in step so
        // those don't drift from fxRates.INR.
        set({ fxRates: next, fxRate: next.INR ?? get().fxRate });
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
      setAuthReady: () => set({ authReady: true }),
      onSignedIn: (walletAddress) =>
        set({ walletAddress, authStatus: 'signedIn', authError: null, authReady: true }),
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
          invitesTotal: 3,
          invitesUsed: 0,
          invites: [],
          recovered: false,
          recoveryPrompted: false,
          onboarded: false,
          firstLoadDone: false,
          provisioned: false,
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
        await platform().session.removeItem('fpay:resumePay');
        await get().logout();
      },
      acknowledgeInvites: async () => {
        try {
          await api.acknowledgeInvites();
        } finally {
          // Drop them here too, and do it even when the POST failed. /me would stop returning them
          // on the next load anyway, but leaving them in memory means a back-navigation re-renders
          // the reveal screen with live codes — and worse, the tabs guard reads the same array, so
          // a failed ack put the user in an unescapable /invites ↔ /home ping-pong. A truly failed
          // ack just re-reveals on the next cold boot, which is annoying, not a trap.
          set({ invites: [] });
        }
      },
      authSync: async (handle, inviteCode) => {
        // Country guess — weakest source, server fills only when unset. Timezone FIRST: it says
        // where the device is, while navigator.language only says how they like things formatted
        // (an en-GB browser in Mumbai used to enrol the user in the United Kingdom, and the
        // balance's local line and the rate calls followed it there). The locale stays as the
        // fallback for engines with no Intl Locale Info. Deliberately no .maximize() on it: a bare
        // "en" must send nothing, not US.
        let country: string | undefined = countryFromTimeZone() || undefined;
        country ??= platform().locale().region;
        const me = await api.authSync({ handle, walletAddress: get().walletAddress, country, inviteCode });
        // Backend user now exists for this Privy identity — unblock data fetches (see `provisioned`).
        set({ walletAddress: me.walletAddress, provisioned: true });
        await get().load();
      },

      // Decode a scanned QR and route: an fpay user's QR → real USDC send; a UPI/merchant QR →
      // the (Phase-2 mock) merchant pay flow; anything else → a friendly error on the Scan sheet.
      handleScan: async (text) => {
        const res = classifyPayTarget(text);
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
          // Keep the VPA: it's WHO the merchant actually pays. Dropping it (as this used to) left the
          // order with a rail but no destination, so no merchant could have settled it.
          set({ error: null });
          get().payPayee({ name: res.name ?? res.payee ?? 'Recipient', vpa: res.payee, rail: 'UPI', currency: 'INR' }, res.amountInr ?? 0);
        } else if (res.kind === 'qris') {
          // Same lifecycle on the Indonesian rail — the NMID is the payout destination, IDR the
          // quote currency. The rail rides on the payee so every quote call names it.
          set({ error: null });
          get().payPayee({ name: res.name ?? 'Recipient', vpa: res.payee, rail: 'QRIS', currency: 'IDR' }, res.amountIdr ?? 0);
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
            // Parse boundary: the quote arrives as decimal strings, the store holds display numbers.
            fees = {
              feeUsd: Number(q.feeUsd),
              railFeeUsd: Number(q.railFeeUsd),
              totalFeeUsd: Number(q.totalFeeUsd),
              etaSecs: q.etaSecs,
            };
          } catch {
            /* quote is display-only — confirm still shows the network without a fee row */
          }
        }
        set({ externalSend: { ...ext, amountUsd: u, ...fees } });
        get().open('sendAddressConfirm');
      },
      doSendExternal: async () => {
        const ext = get().externalSend;
        // money:number — externalSend is CLIENT state built from keypad input, not a wire DTO. It
        // becomes a string at the request boundary; here it is display + optimistic arithmetic.
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
              // money:number — see doSendExternal above; this is the optimistic view row.
              usd: -(ext.amountUsd + ext.totalFeeUsd),
              status: 'pending',
            };
          }
          // money:number — optimistic local balance only; refresh() reconciles against the chain.
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
          set({ busy: false, error: friendlyError(e) });
          get().open('sendFailed');
          return null;
        }
      },

      payPayee: (m, rupees = 0) => {
        // The QR is untrusted text — emvqr/payTarget only assert it parses as a finite positive
        // number, not that it fits the rail. Clamp to the payee currency's minor unit here (the one
        // funnel scanned amounts enter through; the resume path at `resumePay` replays an
        // already-clamped value) so a malformed 3dp QR can't seed an amount the backend would
        // reject at quote time. IDR clamps to whole rupiah.
        const minor = 10 ** fiatDecimals(m.currency ?? 'INR');
        set({ payee: m, scannedRupees: Math.round(rupees * minor) / minor });
        // The scanned rail's rate, fetched now rather than kept warm for every rail on every poll.
        // Not awaited: fxRates is seeded and persisted, so the keypad prices off the last known
        // rate immediately and repaints when the fresh one lands — the binding number is the
        // backend's quote either way.
        void get().syncRates(m.currency);
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
        // reconciler poller, picked up by pollKyc when Persona redirects back to /home with
        // ?inquiry-id=…&status=… appended). The callback carries NO query of our own, so the vendor's
        // appended params can't collide with one (…/home?kyc=done?inquiry-id=… would otherwise
        // mis-parse and skip the poll).
        // No `busy` here on purpose: that flag is global (load() writes it too), so the in-flight
        // state belongs to the caller — sheets/identity.tsx owns a local one.
        try {
          set({ error: null });
          const r = await api.kycVerify(`${platform().origin()}/home`);
          if ('url' in r) {
            set({ kycStatus: 'pending' });
            // The redirect destroys in-memory state; stash the merchant-pay intent so we can resume
            // it when the user returns to /home (pollKyc reads this back).
            if (get().pendingPay) {
              await platform().session.setItem('fpay:resumePay', JSON.stringify({ payee: get().payee, rupees: get().scannedRupees }));
            }
            // Web: leaves the app; control returns via the callback URL and the home page's inquiry-id
            // poll. Native: an in-app browser, and this resolves when it closes — so poll from here.
            await platform().openKyc(r.url);
            void get().pollKyc();
            return;
          }
          set({ kycTier: r.kycTier, kycStatus: 'approved' });
        } catch (e) {
          set({ error: friendlyError(e) });
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
            // country too: approval may have set it from the KYC document (see kyc/poller.ts).
            set({ kycTier: me.kycTier, kycStatus: me.kycStatus ?? get().kycStatus, country: me.country || get().country });
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
      resumePayAfterKyc: async () => {
        // Resume a merchant-pay that was interrupted by the hosted-KYC redirect (see verifyDone).
        try {
          const raw = await platform().session.getItem('fpay:resumePay');
          if (!raw) return;
          await platform().session.removeItem('fpay:resumePay');
          const { payee, rupees } = JSON.parse(raw) as { payee: Payee; rupees: number };
          set({ payee, scannedRupees: rupees ?? 0 });
          // The hosted-KYC redirect reloaded the app, so this payee never passed through payPayee
          // in this process — ask for its rate again rather than trusting the persisted one.
          void get().syncRates(payee.currency);
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

      // ---- pay-by-phone (enrolling IS the consent; the server sends and checks the code) ----
      startPhoneLink: async (phoneNumber) => {
        await api.startPhone(phoneNumber);
      },
      confirmPhoneLink: async (code) => {
        const { phone } = await api.confirmPhone(code); // the server enrolls the number that got the code
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
          // Same parse boundary: per-network decimal strings in, display numbers out.
          const asNumbers = Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, Number(v)]));
          set({ depositBalances: asNumbers, depositBusy: false });
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
          // burnAmountUsd stays a STRING all the way through the stash and back to /crosschain/deposit —
          // it is the amount actually burned on-chain, so it must not round-trip through a float.
          const stash = { sourceChain: network, txHash, amountUsd: prep.burnAmountUsd };
          await platform().storage.setItem('fpay:pendingDeposit', JSON.stringify(stash));
          await api.reportDeposit(stash);
          await platform().storage.removeItem('fpay:pendingDeposit');
          set((s) => ({
            depositBusy: false,
            depositBalances: { ...(s.depositBalances ?? {}), [network]: 0 },
            transactions: [
              {
                id: txHash,
                type: 'add',
                title: 'Added money',
                time: 'Just now',
                usd: Number(prep.burnAmountUsd),
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
        let stash: { sourceChain: string; txHash: string; amountUsd: string | number } | null = null;
        try {
          const raw = await platform().storage.getItem('fpay:pendingDeposit');
          stash = raw ? JSON.parse(raw) : null;
        } catch {
          return;
        }
        if (!stash) return;
        try {
          await api.reportDeposit(stash);
          await platform().storage.removeItem('fpay:pendingDeposit');
        } catch (e) {
          // Already reported → clear; anything else keeps the stash for the next open.
          if (e instanceof ApiError && e.code === 'duplicate_request') await platform().storage.removeItem('fpay:pendingDeposit');
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
          const payee = get().payee;
          const quote = await apiCreateQuote({
            direction: 'spend',
            amountInr: rupees,
            // The rail rode in on the scanned payee; the server derives the currency FROM it.
            payoutMethod: payee.rail ?? 'UPI',
            // WHO the merchant pays. The server re-validates it — this is only the hint.
            payoutDestination: payee.vpa,
            payoutName: payee.name,
          });
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

      refreshQuote: async () => {
        const q = get().quote;
        // Only when near/past expiry, not mid-payment, not already refreshing. The hold window is
        // deliberately invisible to the user — the quote just stays fresh under them.
        if (!q || get().busy || refreshingQuote) return;
        if (q.expiresAt - Date.now() > 5_000) return;
        refreshingQuote = true;
        try {
          const payee = get().payee;
          const quote = await apiCreateQuote({
            direction: 'spend',
            amountInr: q.amountInr,
            payoutMethod: payee.rail ?? 'UPI',
            payoutDestination: payee.vpa,
            payoutName: payee.name,
          });
          set({ quote });
        } catch {
          // Keep the stale quote; confirmOrder's quote_expired retry is the backstop.
        } finally {
          refreshingQuote = false;
        }
      },

      confirmOrder: async () => {
        set({ busy: true, error: null });
        // Two passes: if the quote expired between refresh ticks, silently re-quote the same
        // rupee amount and retry once. Safe — the 409 fires before any order or tx exists.
        for (let attempt = 0; attempt < 2; attempt++) {
          const q = get().quote;
          if (!q) {
            set({ busy: false });
            return;
          }
          try {
            const order = await apiConfirmOrder(q.id);
            // Optimistically debit the escrowed USDC so a second order can't see the same balance;
            // refreshOrder() reconciles against the chain on completion/refund.
            set((s) => ({ order, balanceUSD: +(s.balanceUSD - Number(q.amountUsdc)).toFixed(2), busy: false }));
            get().open('tracking');
            return;
          } catch (e) {
            if (e instanceof ApiError && e.code === 'quote_expired' && attempt === 0) {
              try {
                const payee = get().payee;
                const quote = await apiCreateQuote({
                  direction: 'spend',
                  amountInr: q.amountInr,
                  payoutMethod: payee.rail ?? 'UPI',
                  payoutDestination: payee.vpa,
                  payoutName: payee.name,
                });
                set({ quote });
                continue;
              } catch {
                // Re-quote failed; fall through and report the original error.
              }
            }
            if (e instanceof ApiError && e.code === 'limit_exceeded') {
              set({ busy: false, error: 'Verify your identity to raise your limit.', pendingPay: true });
              get().open('verify');
              return;
            }
            set({ busy: false, error: e instanceof Error ? e.message : String(e) });
            return;
          }
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
        } catch {
          // Background order poll (runs on an interval while tracking) — quiet; the next tick recovers.
        }
      },

      /**
       * "I didn't receive this" — raise a dispute while the merchant's payout is in its release
       * window. The server freezes the auto-release so the escrow can't pay out to the merchant
       * until a human resolves it; an upheld dispute refunds the payer and slashes the merchant's
       * stake.
       */
      disputeOrder: async (reason, orderId) => {
        const current = get().order;
        if (!current) return;
        set({ busy: true, error: null });
        try {
          // A payment made in parts is disputed per part — each leg is its own order server-side.
          await api.disputeOrder(orderId ?? current.id, reason);
          set({ busy: false });
          get().notify("Reported. We'll review and get back to you.", 'success');
          await get().refreshOrder();
        } catch (e) {
          set({ busy: false, error: friendlyError(e) });
        }
      },

      // One-tap 👍/👎 on the Paid card. Errors are swallowed: a 409 means it's already recorded,
      // and there's nothing for the user to fix either way — patch the local order and move on.
      feedbackOrder: async (up) => {
        const current = get().order;
        if (!current) return;
        set({ order: { ...current, feedbackUp: up } });
        try {
          await api.orderFeedback(current.id, up);
        } catch {
          // best-effort; the prompt simply won't reappear for this order
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
        const tx = await get().doSend(Number(r.amountUsd));
        if (!tx) return; // doSend already set the error
        try {
          await wallet.payRequest(id, tx.id);
          set((s) => ({
            requests: s.requests.map((x) => (x.id === id ? { ...x, status: 'paid' } : x)),
          }));
          void get().refresh();
        } catch (e) {
          get().notify(friendlyError(e));
        }
      },

      cancelRequest: async (id) => {
        try {
          await wallet.cancelRequest(id);
          set((s) => ({
            requests: s.requests.map((x) => (x.id === id ? { ...x, status: 'cancelled' } : x)),
          }));
        } catch (e) {
          get().notify(friendlyError(e));
        }
      },

      doAdd: async (amt) => {
        // Fund via the devnet faucet. Keep the sheet open (button shows "Adding…") until the balance
        // settles, then close on the updated number. On failure (e.g. faucet_empty) toast a friendly
        // line and leave the sheet open so the user can retry.
        set({ busy: true, error: null });
        try {
          await wallet.addMoney?.(amt);
          await get().refresh();
          get().close();
        } catch (e) {
          get().notify(friendlyError(e));
        } finally {
          set({ busy: false });
        }
      },

      completeOnboarding: () => set({ onboarded: true }),
    }),
    {
      name: 'pay-store',
      version: 2,
      migrate: (persisted: unknown) => {
        const s = (persisted ?? {}) as Record<string, unknown>;
        // v1: the old cosmetic `kyc: boolean` became the real `kycTier` (verified → tier 2).
        if (typeof s.kycTier !== 'number') s.kycTier = s.kyc === true ? 2 : 1;
        delete s.kyc;
        // v2: drop the stored display currency so it falls back to the new USD default. Everyone
        // holding 'INR' got it from the old default rather than by choosing it, and without this
        // they keep reading a conversion where the balance itself belongs.
        delete s.displayCurrency;
        return s as unknown as PayState;
      },
      // The platform's storage, read lazily: configure() runs before the first render but after this
      // module evaluates, so hydration is skipped here and kicked off by configure() instead.
      storage: createJSONStorage(() => ({
        getItem: (k) => platform().storage.getItem(k),
        setItem: (k, v) => platform().storage.setItem(k, v),
        removeItem: (k) => platform().storage.removeItem(k),
      })),
      skipHydration: true,
      partialize: (s) => ({
        onboarded: s.onboarded,
        kycTier: s.kycTier,
        recovered: s.recovered,
        recoveryPrompted: s.recoveryPrompted,
        balanceUSD: s.balanceUSD,
        fxRate: s.fxRate,
        // Persisted alongside `fxRate` so a returning user's local-currency line paints at the last
        // known rate instead of flashing the hardcoded seed before syncRates lands.
        fxRates: s.fxRates,
        transactions: s.transactions,
        displayCurrency: s.displayCurrency,
        localCurrency: s.localCurrency,
        // The eye persists (device-local privacy choice); the flip deliberately does not.
        hideAmounts: s.hideAmounts,
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
      platform().trace('store hydrated (sync)');
      return;
    }
    const done = () => {
      platform().trace('store hydrated');
      setHydrated(true);
    };
    const unsub = usePayStore.persist.onFinishHydration(done);
    if (usePayStore.persist.hasHydrated()) done();
    const t = setTimeout(() => {
      platform().trace('store hydrate TIMEOUT, proceeding empty');
      setHydrated(true);
    }, 3000);
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, [hydrated]);
  return hydrated;
}
