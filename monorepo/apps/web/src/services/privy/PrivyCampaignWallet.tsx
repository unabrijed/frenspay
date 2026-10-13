'use client';
import { usePrivy, useLinkAccount, useSendTransaction } from '@privy-io/react-auth';
import { useExportWallet } from '@privy-io/react-auth/solana';
import type { ReactNode } from 'react';
import { CampaignWalletProvider } from '@/components/campaign/CampaignWallet';

export function PrivyCampaignWallet({ children }: { children: ReactNode }) {
  const { user, getAccessToken, logout, exportWallet } = usePrivy();
  const { exportWallet: exportSolana } = useExportWallet();
  const { sendTransaction } = useSendTransaction();
  const { linkTwitter } = useLinkAccount();
  return <CampaignWalletProvider value={{ provider: 'privy',
    user: user ? { id: user.id, linkedAccounts: user.linkedAccounts.flatMap(a =>
      a.type === 'wallet' ? [{type: 'wallet' as const, walletClientType: a.walletClientType ?? '', chainType: a.chainType, address: a.address}] : []) } : null,
    getAccessToken, logout, linkTwitter: async () => { linkTwitter(); },
    exportWallet: options => user?.linkedAccounts.some(a => a.type === 'wallet' && a.chainType === 'solana' && a.address === options?.address)
      ? exportSolana(options) : exportWallet(options),
    sendTransaction,
  }}>{children}</CampaignWalletProvider>;
}
