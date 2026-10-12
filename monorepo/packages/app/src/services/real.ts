// real.ts — RealWalletProvider: the WalletProvider backed by the Railway API + active Signer.
// transfer() = prepare (server builds + fee-payer-signs) → signAndSend (client) → submit (record).
import {
  type ApiPaymentRequest,
  type CreateRequestRequest,
  truncateAddress,
  type Txn,
  type WalletProvider,
} from '@fpay/shared';

import { api, ApiError } from './api';
import { platform } from '../platform';
import { apiTxnToTxn } from './mappers';
import { getActiveSigner } from './signer';

async function bestEffortStorage(action: () => unknown): Promise<void> {
  try {
    await action();
  } catch {
    /* Server reconciliation also recovers missing receipts. */
  }
}

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
    requestId,
  }: {
    toHandle?: string;
    toAddress?: string;
    amountUsd: number;
    note?: string;
    idempotencyKey?: string;
    requestId?: string;
  }): Promise<Txn> {
    let attemptKey =
      idempotencyKey ??
      (requestId ? `bill-${requestId}-${Date.now()}-${Math.random().toString(36).slice(2)}` : undefined);
    const stashKey = requestId ? `expense-payment:${platform().env.apiUrl}:${requestId}` : null;
    const attempt = async (): Promise<string> => {
      if (stashKey) {
        const stashed = await platform().storage.getItem(stashKey);
        if (stashed) {
          const pending = JSON.parse(stashed) as { attemptKey?: string; transferId?: string; signature?: string };
          if (pending.signature && pending.transferId) {
            await api.submitTransfer({ transferId: pending.transferId, signature: pending.signature });
            await bestEffortStorage(() => platform().storage.removeItem(stashKey));
            return pending.transferId;
          }
          // A definitive server failure releases the reservation. An ambiguous attempt stays held.
          const latest = (await api.requests()).requests.find((r) => r.id === requestId);
          if (!latest || latest.status !== 'open') throw new Error('request_payment_pending');
          if (latest.transferId) throw new Error('request_payment_pending');
          // The previous prepare may never have reached the server. Reuse its key unless the
          // server reports a definitive failure; that response clears the stale key.
          attemptKey = pending.attemptKey ?? attemptKey;
        }
        // Fail before invoking the wallet if recovery metadata cannot be persisted.
        await platform().storage.setItem(stashKey, JSON.stringify({ attemptKey }));
      }
      // Signer first: Home is reachable before the wallet is, and a prepared-never-signed transfer
      // would leave a pending row behind.
      const signer = getActiveSigner();
      const prep = await api.prepareTransfer({
        toHandle,
        toAddress,
        amountUsd,
        note,
        idempotencyKey: attemptKey,
        requestId,
      });
      if (stashKey)
        await platform().storage.setItem(stashKey, JSON.stringify({ attemptKey, transferId: prep.transferId }));
      const signature = await signer.signAndSend(prep.unsignedTx, { sponsored: prep.sponsored });
      if (stashKey)
        await bestEffortStorage(() =>
          platform().storage.setItem(stashKey, JSON.stringify({ attemptKey, transferId: prep.transferId, signature })),
        );
      await api.submitTransfer({ transferId: prep.transferId, signature });
      if (stashKey) await bestEffortStorage(() => platform().storage.removeItem(stashKey));
      return prep.transferId;
    };
    let transferId: string;
    try {
      transferId = await attempt();
    } catch (e) {
      if (stashKey && e instanceof ApiError && (e.code === 'request_payment_failed' || e.code === 'solana_unavailable'))
        await bestEffortStorage(() => platform().storage.removeItem(stashKey));
      // A prepared blockhash can expire before the user signs (preflight rejects it — nothing was
      // broadcast, so the retry can't double-send); re-prepare + retry once. The same idempotency
      // key replays the abandoned row server-side (fresh blockhash, same transfer) rather than 409ing.
      if (!requestId && /blockhash/i.test(e instanceof Error ? e.message : String(e))) transferId = await attempt();
      else throw e;
    }
    const counterparty = toHandle ?? truncateAddress(toAddress ?? '');
    // Optimistic row; status flips + amount/time reconcile via getTransactions() (post-send poll).
    return {
      id: transferId,
      type: 'send',
      title: 'To ' + counterparty,
      time: 'Just now',
      usd: -amountUsd,
      status: 'pending',
    };
  }

  depositAddress(): string {
    return ''; // real deposit address comes from /me (walletAddress); surfaced via the store
  }

  async getRequests(): Promise<ApiPaymentRequest[]> {
    const requests = (await api.requests()).requests;
    let submitted = false;
    for (const r of requests.filter((r) => r.expenseId && r.direction === 'incoming')) {
      const key = `expense-payment:${platform().env.apiUrl}:${r.id}`;
      try {
        const stashed = await platform().storage.getItem(key);
        if (!stashed) continue;
        const pending = JSON.parse(stashed) as { transferId?: string; signature?: string };
        if (r.status === 'paid' || r.status === 'cancelled') {
          await platform().storage.removeItem(key);
        } else if (pending.signature && pending.transferId) {
          await api.submitTransfer({ transferId: pending.transferId, signature: pending.signature });
          submitted = true;
          await bestEffortStorage(() => platform().storage.removeItem(key));
        }
      } catch {
        /* A receipt-storage outage must not hide the user's debts. */
      }
    }
    return submitted ? (await api.requests()).requests : requests;
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
