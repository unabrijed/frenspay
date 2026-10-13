import type { CampaignAccount, CampaignCapabilities, CampaignQuote, CampaignSpend, PrelaunchTransaction } from '@fpay/shared';
import { request } from './api';
const call = <T>(path: string, body?: unknown) => request<T>('/campaign/' + path, {
  method: body === undefined ? 'GET' : 'POST',
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store',
  signal: AbortSignal.timeout(30000),
});
export interface PendingWithdrawal { id: string; recipient: string; amount: string; tx_hash: string | null }
export const campaignApi = {
  capabilities: () => call<CampaignCapabilities>('capabilities'),
  session: () => call<CampaignAccount>('session', {}),
  account: () => call<CampaignAccount>('account'),
  sync: () => call<CampaignAccount>('balance/sync', {}),
  profile: (name: string, country: string) => call<CampaignAccount>('profile', { name, country }),
  phoneStart: (phone: string) => call<{ok: true}>('phone/start', {phone}),
  phoneConfirm: (code: string) => call<CampaignAccount>('phone/confirm', {code}),
  quote: (qr: string, amountInr: string) => call<CampaignQuote>('quotes', { qr, amountInr }),
  spend: (quoteId: string, idempotencyKey: string) => call<CampaignSpend>('spends', { quoteId, idempotencyKey }),
  history: () => call<{ spends: CampaignSpend[] }>('history'),
  withdraw: (to: string, amount: string, idempotencyKey: string) => call<{id: string; transaction: PrelaunchTransaction}>('withdraw/prepare', {to, amount, idempotencyKey}),
  withdrawalPending: () => call<{withdrawal: PendingWithdrawal | null}>('withdraw/pending'),
  withdrawalStatus: (id: string, hash: string) => call<{status: 'pending'|'confirmed'|'failed'}>('withdraw/status', {id, hash}),
  cancelWithdrawal: (id: string) => call<{ok: true}>('withdraw/cancel', {id}),
};
