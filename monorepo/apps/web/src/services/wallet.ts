// wallet.ts — the web-side wallet seam. The contract types live in @fpay/shared (the Railway
// backend uses the same types). The app always talks to the real backend via RealWalletProvider.

import { RATE_LABEL, type WalletProvider } from '@fpay/shared';

import { RealWalletProvider } from './real';

// Re-export the shared contract so existing `@/services/wallet` imports keep working.
export type { Friend, Merchant, RateLockQuote, SettlementProvider, Txn, TxnType, WalletProvider } from '@fpay/shared';
export { RATE_LABEL };

/* ---- active provider: the app always talks to the real backend ---- */
export const wallet: WalletProvider = new RealWalletProvider();
