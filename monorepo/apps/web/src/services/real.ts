// real.ts — RealWalletProvider: the WalletProvider backed by the Railway API + active Signer.
// transfer() = prepare (server builds + fee-payer-signs) → signAndSend (client) → submit (record).
import type { ApiPaymentRequest, CreateRequestRequest, Txn, WalletProvider } from '@fpay/shared';
import { truncateAddress } from '@fpay/shared';

import { api } from './api';
import { DEV_SECRET_KEY, SOLANA_RPC_URL } from './envConfig';
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

  async resolvePhone(phone: string) {
    return (await api.resolvePhone(phone)).user;
  }

  async transfer({
    toHandle,
    toAddress,
    amountUsd,
    note,
    idempotencyKey,
  }: {
    toHandle?: string;
    toAddress?: string;
    amountUsd: number;
    note?: string;
    idempotencyKey?: string;
  }): Promise<Txn> {
    const attempt = async (): Promise<string> => {
      const prep = await api.prepareTransfer({ toHandle, toAddress, amountUsd, note, idempotencyKey });
      const signature = await getActiveSigner().signAndSend(prep.unsignedTx);
      await api.submitTransfer({ transferId: prep.transferId, signature });
      return prep.transferId;
    };
    let transferId: string;
    try {
      transferId = await attempt();
    } catch (e) {
      // A prepared blockhash can expire before the user signs (preflight rejects it — nothing was
      // broadcast, so the retry can't double-send); re-prepare + retry once. The same idempotency
      // key replays the abandoned row server-side (fresh blockhash, same transfer) rather than 409ing.
      if (/blockhash/i.test(e instanceof Error ? e.message : String(e))) transferId = await attempt();
      else throw e;
    }
    const counterparty = toHandle ?? truncateAddress(toAddress ?? '');
    // Optimistic row; status flips + amount/time reconcile via getTransactions() (post-send poll).
    return { id: transferId, type: 'send', title: 'To ' + counterparty, time: 'Just now', usd: -amountUsd, status: 'pending' };
  }

  depositAddress(): string {
    return ''; // real deposit address comes from /me (walletAddress); surfaced via the store
  }

  async addMoney(amountUsd: number): Promise<Txn> {
    // Devnet faucet: backend mints controlled USDC to the caller's wallet.
    const { signature } = await api.faucet({ amountUsd });
    return { id: signature, type: 'add', title: 'Added money', time: 'Just now', usd: amountUsd, status: 'confirmed' };
  }

  async getRequests(): Promise<ApiPaymentRequest[]> {
    return (await api.requests()).requests;
  }

  async createRequest(input: CreateRequestRequest): Promise<ApiPaymentRequest> {
    return api.createRequest(input);
  }

  async payRequest(requestId: string, transferId: string): Promise<void> {
    await api.payRequest(requestId, transferId);
  }

  async cancelRequest(requestId: string): Promise<void> {
    await api.cancelRequest(requestId);
  }
}
