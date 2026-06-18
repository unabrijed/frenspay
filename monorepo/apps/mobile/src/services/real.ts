// real.ts — RealWalletProvider: the WalletProvider backed by the Railway API + active Signer.
// transfer() = prepare (server builds + fee-payer-signs) → signAndSend (client) → submit (record).
import type { Txn, WalletProvider } from '@pay/shared';

import { api } from './api';
import { DEV_SECRET_KEY, SOLANA_RPC_URL } from './env';
import { apiTxnToTxn } from './mappers';
import { DevKeypairSigner, getActiveSigner, setActiveSigner } from './signer';

// Register the dev keypair as the default signer when a secret is provided. The Privy bridge
// overrides this via setActiveSigner() once the user logs in.
if (DEV_SECRET_KEY) {
  try {
    setActiveSigner(new DevKeypairSigner(JSON.parse(DEV_SECRET_KEY) as number[], SOLANA_RPC_URL));
  } catch {
    // malformed EXPO_PUBLIC_DEV_SECRET_KEY — leave unset; transfer() will surface a clear error
  }
}

export class RealWalletProvider implements WalletProvider {
  async getBalanceUsd(): Promise<number> {
    return (await api.balance()).balanceUsd;
  }

  async getTransactions(): Promise<Txn[]> {
    return (await api.transactions()).transactions.map(apiTxnToTxn);
  }

  async resolveHandle(handle: string) {
    return (await api.resolve(handle)).user;
  }

  async transfer({ toHandle, amountUsd, note }: { toHandle: string; amountUsd: number; note?: string }): Promise<Txn> {
    const attempt = async (): Promise<string> => {
      const prep = await api.prepareTransfer({ toHandle, amountUsd, note });
      const signature = await getActiveSigner().signAndSend(prep.unsignedTx);
      await api.submitTransfer({ transferId: prep.transferId, signature });
      return prep.transferId;
    };
    let transferId: string;
    try {
      transferId = await attempt();
    } catch (e) {
      // A prepared blockhash can expire before the user signs; re-prepare + retry once.
      if (/blockhash/i.test(e instanceof Error ? e.message : String(e))) transferId = await attempt();
      else throw e;
    }
    // Optimistic row; confirmed amount/time reconcile via getTransactions().
    return { id: transferId, type: 'send', title: 'To ' + toHandle, time: 'Just now', usd: -amountUsd };
  }

  depositAddress(): string {
    return ''; // real deposit address comes from /me (walletAddress); surfaced via the store
  }
}
