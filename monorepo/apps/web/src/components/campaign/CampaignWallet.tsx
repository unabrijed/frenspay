'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { PrelaunchTransaction } from '@fpay/shared';

export interface CampaignWallet {
  provider: 'dynamic';
  fundFromWallet?: (address: string) => Promise<void>;
  user: { id: string; linkedAccounts: { type: 'wallet'; walletClientType: string; chainType: string; address: string }[] } | null;
  getAccessToken: () => Promise<string | null>;
  logout: () => Promise<void>;
  exportWallet: (options?: { address: string }) => Promise<unknown>;
  linkTwitter: () => Promise<unknown>;
  sendTransaction: (transaction: PrelaunchTransaction, options: { address: string; sponsor: boolean }) => Promise<{ hash: string }>;
}
const Context = createContext<CampaignWallet | null>(null);
export function CampaignWalletProvider({ value, children }: { value: CampaignWallet; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useCampaignWallet() {
  const wallet = useContext(Context);
  if (!wallet) throw new Error('Wallet provider is unavailable.');
  return wallet;
}
