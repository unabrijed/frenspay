// real.ts — RealWalletProvider: the WalletProvider backed by the Railway API + active Signer.
// transfer() = prepare (server builds + fee-payer-signs) → signAndSend (client) → submit (record).
import { type ApiPaymentRequest, type CreateRequestRequest, truncateAddress, type Txn, type WalletProvider } from '@fpay/shared';

import { api } from './api';
import { apiTxnToTxn } from './mappers';
import { getActiveSigner } from './signer';

export class RealWalletProvider implements WalletProvider {
  // The other parse boundary (see mappers.ts): the wire carries a decimal string, the store holds
  // a display number. Everything that MOVES money goes back over the wire as a string.
  async getBalanceUsd(): Promise<number> {
    return Number((await api.balance()).balanceUsd);
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
      // Signer first: Home is reachable before the wallet is, and a prepared-never-signed transfer
      // would leave a pending row behind.
      const signer = getActiveSigner();
      const prep = await api.prepareTransfer({ toHandle, toAddress, amountUsd, note, idempotencyKey });
      const signature = await signer.signAndSend(prep.unsignedTx, { sponsored: prep.sponsored });
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
