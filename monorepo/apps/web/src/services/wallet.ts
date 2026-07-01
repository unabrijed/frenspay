// wallet.ts — the web-side wallet seam. The contract types live in @fpay/shared (the Railway
// backend uses the same types). The app always talks to the real backend via RealWalletProvider;
// this file only keeps the shared FRIENDS demo list used as a fallback in the people picker.

import { RATE_LABEL, type Friend, type WalletProvider } from '@fpay/shared';

import { RealWalletProvider } from './real';

// Re-export the shared contract so existing `@/services/wallet` imports keep working.
export type { Friend, Merchant, RateLockQuote, SettlementProvider, Txn, TxnType, WalletProvider } from '@fpay/shared';
export { RATE_LABEL };

/* ---- demo friends: fallback list in the people picker until real contacts resolve ---- */
export const FRIENDS: Friend[] = [
  { name: 'Neha R.', handle: '@neha', ini: 'N' },
  { name: 'Arjun M.', handle: '@arjun', ini: 'A' },
  { name: 'Sam K.', handle: '@sam', ini: 'S' },
  { name: 'Priya V.', handle: '@priya', ini: 'P' },
];

/* ---- active provider: the app always talks to the real backend ---- */
export const wallet: WalletProvider = new RealWalletProvider();
