// wallet.ts — the mobile-side seam. The contract types live in @pay/shared (the
// Railway backend uses the same types); this file keeps the in-memory Mock*
// implementations and demo data the app runs on today.
//
// In Phase 1 the real providers (Privy embedded wallet + Solana USDC transfers via
// Helius, the Railway Fastify API) drop in here with no UI changes. Phase 2 (INR
// merchant settlement via the licensed partner float) becomes the real SettlementProvider.

import {
  RATE,
  RATE_LABEL,
  rupeesToUsd,
  type Friend,
  type Merchant,
  type SettlementProvider,
  type WalletProvider,
} from '@pay/shared';

import { RealWalletProvider } from './real';

// Re-export the shared contract so existing `@/services/wallet` imports keep working.
export type { Friend, Merchant, RateLockQuote, SettlementProvider, Txn, TxnType, WalletProvider } from '@pay/shared';
export { RATE_LABEL };

/* ---- mock data ---- */
export const FRIENDS: Friend[] = [
  { name: 'Neha R.', handle: '@neha', ini: 'N' },
  { name: 'Arjun M.', handle: '@arjun', ini: 'A' },
  { name: 'Sam K.', handle: '@sam', ini: 'S' },
  { name: 'Priya V.', handle: '@priya', ini: 'P' },
];

export const DEMO_MERCHANTS: Merchant[] = [
  { name: 'Anjuna Beach Cafe' },
  { name: 'Auto rickshaw' },
  { name: 'Mango Tree Restaurant' },
];

export const USDC_DEPOSIT_ADDRESS = '7xBn…mK4q';

/* ---- mock implementations (local math; no network) ---- */
export const MockSettlementProvider: SettlementProvider = {
  async quoteSpend({ rupees }) {
    const now = Date.now();
    return {
      rupees,
      usdc: rupeesToUsd(rupees),
      rate: RATE,
      rateLabel: RATE_LABEL,
      quotedAt: now,
      expiresAt: now + 60_000,
    };
  },
  async executeSpend(quote) {
    return { settled: true, usdDebited: quote.usdc, rupees: quote.rupees };
  },
};

/* ---- active providers: the app always talks to the real backend ---- */
export const wallet: WalletProvider = new RealWalletProvider();
export const settlement: SettlementProvider = MockSettlementProvider; // Phase 2 (merchant INR) stays mock
