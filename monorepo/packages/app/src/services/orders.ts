// orders.ts — the M1 order-lifecycle client. Mirrors real.ts's prepare → sign → submit pattern:
// confirmOrder() funds escrow by signing the server-built tx with the active signer (Privy embedded
// wallet, or the dev keypair), then records the signature so the backend confirmer can advance the
// order. The Quote screen and order timeline drive these.
import { type CreateOrderResponse, type Order, type OrderDirection, type PayoutMethod, type Quote } from '@fpay/shared';

import { api } from './api';
import { getActiveSigner } from './signer';

export async function createQuote(input: {
  direction: OrderDirection;
  amountInr: string | number;
  payoutMethod?: PayoutMethod;
  /** The payee's real UPI ID — WHO the merchant pays. `payoutMethod` is only the rail. */
  payoutDestination?: string;
  payoutName?: string;
}): Promise<Quote> {
  return (await api.createQuote(input)).quote;
}

/**
 * Confirm a quote → create the order, sign+broadcast the escrow-funding tx, record the signature.
 * If signing fails, cancel the just-created order so no orphaned `pay_instructions` row is left
 * behind; a stale blockhash (expires before the user signs) re-creates + retries once, mirroring
 * the P2P `transfer()` flow in real.ts.
 */
export async function confirmOrder(quoteId: string): Promise<Order> {
  const attempt = async (): Promise<Order> => {
    const res: CreateOrderResponse = await api.createOrder({ quoteId });
    try {
      const signature = await getActiveSigner().signAndSend(res.unsignedTx);
      await api.fundSubmit(res.order.id, { transferId: res.transferId, signature });
      return res.order;
    } catch (e) {
      await api.cancelOrder(res.order.id).catch(() => {});
      throw e;
    }
  };
  try {
    return await attempt();
  } catch (e) {
    if (/blockhash/i.test(e instanceof Error ? e.message : String(e))) return attempt();
    throw e;
  }
}

export async function getOrder(id: string): Promise<Order> {
  return (await api.getOrder(id)).order;
}
