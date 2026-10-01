// Isolated StraitsX sandbox integration. Deliberately NOT registered in the real-order adapter map.
// Docs: https://docs.straitsx.com/reference/create-a-third-party-payout (v1)
import type { PayNowDestination } from '@fpay/shared';

import { formatAmount, parseAmount } from '../../../lib/units';
import type { PayoutCheck } from '../provider';

export const STRAITSX_SANDBOX_ID = 'straitsx_sg_sandbox';
export const STRAITSX_SANDBOX_ADAPTER = 'straitsx_sandbox';
export const STRAITSX_SANDBOX_URL = 'https://api-sandbox.straitsx.com/v1';

export const usableStraitsxSecret = (secret: string): boolean => !!secret.trim() && !/[<>]|your[-_ ]/i.test(secret);

/** Both identity and adapter are checked: editing one DB column cannot turn a sandbox row live. */
export function isSandboxPayoutProvider(row: { id: string; adapter: string; payout_method: string }): boolean {
  return row.id === STRAITSX_SANDBOX_ID || row.adapter === STRAITSX_SANDBOX_ADAPTER || row.payout_method === 'PayNow';
}

export class StraitsxSandboxError extends Error {
  constructor(message: string, readonly httpStatus?: number) {
    super(`StraitsX sandbox: ${message}`);
  }
}

export interface SandboxPersonalProfile {
  customerName: string;
  registrationType: 'personal';
  registrationIdType: 'passport' | 'identity_card';
  registrationIdCountry: string;
  registrationId: string;
  dateOfBirth: string;
  nationality: string;
  countryOfResidence: string;
  merchantRef: string;
  address: { street: string; city: string; state?: string; postalCode?: string; country: string };
}

interface Resource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
}

export interface SandboxPayout extends PayoutCheck {
  providerRef: string;
  reference: string;
  amountSgd: string;
  destination: PayNowDestination;
  externalReference?: string;
}

function identifier(value: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,191}$/.test(value)) throw new StraitsxSandboxError('invalid identifier');
  return encodeURIComponent(value);
}

function sgd(raw: string): string {
  const value = parseAmount(raw, 2);
  if (!value.gt(0) || value.gt(200_000)) throw new StraitsxSandboxError('amount must be positive and at most SGD 200000');
  return formatAmount(value, 2);
}

function validDestination(destination: PayNowDestination): void {
  const valid = destination && typeof destination.proxyValue === 'string' && (
    (destination.proxyType === 'uen' && /^[A-Z0-9]{9,13}$/.test(destination.proxyValue)) ||
    (destination.proxyType === 'mobile_number' && /^\+65[89]\d{7}$/.test(destination.proxyValue))
  );
  if (!valid) {
    throw new StraitsxSandboxError('unsupported PayNow destination');
  }
}

function resource(body: unknown, expectedType: string): Resource {
  const data = (body as { data?: Resource } | null)?.data;
  if (!data || typeof data.id !== 'string' || data.type !== expectedType ||
      !data.attributes || typeof data.attributes !== 'object' || Array.isArray(data.attributes)) {
    throw new StraitsxSandboxError('malformed API response');
  }
  identifier(data.id);
  return data;
}

function payout(body: unknown): SandboxPayout {
  const { id, attributes: a } = resource(body, 'paynowTransaction');
  if (typeof a.idempotencyId !== 'string' || typeof a.amount !== 'string' || typeof a.status !== 'string') {
    throw new StraitsxSandboxError('malformed payout response');
  }
  identifier(a.idempotencyId);
  const destination = a.disbursementMethod as PayNowDestination;
  validDestination(destination);
  return {
    status: a.status === 'completed' ? 'paid' : a.status === 'failed' ? 'failed' : 'pending',
    raw: a.status,
    providerRef: id,
    reference: a.idempotencyId,
    amountSgd: sgd(a.amount),
    destination: { proxyType: destination.proxyType, proxyValue: destination.proxyValue },
    externalReference: typeof a.externalReference === 'string' ? a.externalReference : undefined,
  };
}

/** Fixed sandbox host; no environment variable or caller-supplied URL can select production.
 *  fetch is a transport seam for offline tests, not an environment/config setting. */
export function makeStraitsxSandboxClient(options: { apiKey: string; fetch?: typeof fetch }) {
  if (!usableStraitsxSecret(options.apiKey)) throw new StraitsxSandboxError('sandbox API key is missing');
  const transport = options.fetch ?? fetch;
  async function request(path: string, body?: unknown, allowNotFound = false, method?: 'PUT'): Promise<unknown> {
    let response: Response;
    try {
      response = await transport(`${STRAITSX_SANDBOX_URL}${path}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { 'X-XFERS-APP-API-KEY': options.apiKey, accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(6_000),
        redirect: 'error', // never forward credentials to a redirect target
      });
    } catch {
      throw new StraitsxSandboxError('request unresolved (transport error or timeout)');
    }
    if (allowNotFound && response.status === 404) return null;
    // Never log a vendor body: it may echo identity information or credentials.
    if (!response.ok) throw new StraitsxSandboxError(`HTTP ${response.status}`, response.status);
    if (response.status === 204) return null;
    try { return await response.json(); }
    catch { throw new StraitsxSandboxError('malformed JSON response'); }
  }
  const profilePath = (id: string) => `/customer_profile/${identifier(id)}`;

  return {
    // Sandbox simulations are only used by the opt-in smoke tool. They cannot target production.
    async simulateProfileVerified(customerProfileId: string): Promise<void> {
      await request(`/sandbox/kyc/customer_profiles/${identifier(customerProfileId)}`,
        { data: { attributes: { verificationStatus: 'verified' } } }, false, 'PUT');
    },
    async topUpVirtualSgd(amountSgd: string): Promise<void> {
      await request('/sandbox/merchant/topup', { data: { attributes: { currency: 'SGD', amount: sgd(amountSgd) } } });
    },
    async simulatePayoutStatus(customerProfileId: string, contractId: string, status: 'completed' | 'failed'): Promise<void> {
      if (status !== 'completed' && status !== 'failed') throw new StraitsxSandboxError('invalid simulated status');
      await request(`/sandbox/customer_profile/${identifier(customerProfileId)}/payouts/${identifier(contractId)}`,
        { data: { attributes: { status } } }, false, 'PUT');
    },
    async createCustomerProfile(input: SandboxPersonalProfile): Promise<string> {
      return resource(await request('/kyc/customer_profiles', input), 'customer_profile').id;
    },
    async createRecipient(customerProfileId: string, destination: PayNowDestination, name: string): Promise<string> {
      validDestination(destination);
      if (typeof name !== 'string' || !name.trim() || name.length > 150) throw new StraitsxSandboxError('recipient name required');
      const body = await request(`${profilePath(customerProfileId)}/payout-recipients`, { data: { attributes: {
        recipientCountry: 'SG',
        recipientInformation: {
          disbursementMethod: 'paynow', currency: 'SGD', recipientName: name.trim(),
          entityType: destination.proxyType === 'uen' ? 'business' : 'individual',
          proxyType: destination.proxyType, proxyValue: destination.proxyValue,
        },
      } } });
      return resource(body, 'payoutRecipient').id;
    },
    async createPayout(input: {
      customerProfileId: string; recipientId: string; reference: string; amountSgd: string; externalReference?: string;
    }): Promise<SandboxPayout> {
      identifier(input.reference);
      identifier(input.recipientId);
      const amount = sgd(input.amountSgd);
      if (input.externalReference !== undefined && (!input.externalReference.trim() || input.externalReference.length > 150)) {
        throw new StraitsxSandboxError('invalid external reference');
      }
      return payout(await request(`${profilePath(input.customerProfileId)}/payouts`, { data: { attributes: {
        idempotencyId: input.reference,
        // money:number — the API requires a JSON number, bounded to 200000 and validated at 2dp.
        amount: Number(amount),
        payoutRecipient: { payoutRecipientId: input.recipientId, disbursementMethod: 'paynow', walletSource: 'sgd' },
        disbursementDetails: { externalReference: input.externalReference ?? input.reference },
      } } }));
    },
    async getPayout(customerProfileId: string, reference: string): Promise<SandboxPayout | null> {
      // The API explicitly accepts idempotency_id in place of the contract ID. Survives restarts
      // and a lost POST response without any dependency on the real orders table.
      const body = await request(`${profilePath(customerProfileId)}/payouts/${identifier(reference)}`, undefined, true);
      return body === null ? null : payout(body);
    },
  };
}

export type StraitsxSandboxClient = ReturnType<typeof makeStraitsxSandboxClient>;
export interface SandboxInitiate {
  reference: string;
  amountFiat: string;
  currency: 'SGD';
  destination: PayNowDestination;
  name: string;
  externalReference?: string;
}

/** Reference-driven initiate/check seam like PayoutProvider, but deliberately NOT assignable to it:
 *  typed destinations and an explicit sandbox profile prevent plugging it into real orders. */
export function makeStraitsxSandboxPayout(client: StraitsxSandboxClient, customerProfileId: string) {
  identifier(customerProfileId);
  const inFlight = new Map<string, { input: string; promise: Promise<SandboxPayout> }>();
  function matches(result: SandboxPayout, input: SandboxInitiate): SandboxPayout {
    if (result.reference !== input.reference || result.amountSgd !== sgd(input.amountFiat) ||
        result.destination.proxyType !== input.destination.proxyType || result.destination.proxyValue !== input.destination.proxyValue ||
        result.externalReference !== (input.externalReference ?? input.reference)) {
      throw new StraitsxSandboxError('payout reference conflicts with request');
    }
    return result;
  }
  async function initiate(input: SandboxInitiate): Promise<SandboxPayout> {
    const existing = await client.getPayout(customerProfileId, input.reference);
    if (existing) return matches(existing, input);
    const recipientId = await client.createRecipient(customerProfileId, input.destination, input.name);
    try {
      return matches(await client.createPayout({ customerProfileId, recipientId, reference: input.reference,
        amountSgd: input.amountFiat, externalReference: input.externalReference }), input);
    } catch (error) {
      // A 409, timeout, 5xx or broken response is NOT proof of failure. Look up the SAME key; never
      // mint a replacement reference. If lookup is inconclusive, propagate unresolved to the tool.
      const recovered = await client.getPayout(customerProfileId, input.reference);
      if (recovered) return matches(recovered, input);
      throw error;
    }
  }
  return {
    id: STRAITSX_SANDBOX_ID,
    sandboxOnly: true as const,
    async initiate(input: SandboxInitiate): Promise<SandboxPayout> {
      identifier(input.reference);
      if (input.currency !== 'SGD') throw new StraitsxSandboxError('only SGD is supported');
      validDestination(input.destination);
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 150) throw new StraitsxSandboxError('recipient name required');
      if (input.externalReference !== undefined && (!input.externalReference.trim() || input.externalReference.length > 150)) {
        throw new StraitsxSandboxError('invalid external reference');
      }
      // Snapshot before awaiting: callers cannot mutate the destination of an in-flight payout.
      const snapshot: SandboxInitiate = { reference: input.reference, currency: 'SGD', amountFiat: sgd(input.amountFiat),
        destination: { proxyType: input.destination.proxyType, proxyValue: input.destination.proxyValue },
        name: input.name.trim(), externalReference: input.externalReference ?? input.reference };
      const identity = JSON.stringify(snapshot);
      const previous = inFlight.get(snapshot.reference);
      if (previous) {
        if (previous.input !== identity) throw new StraitsxSandboxError('concurrent reference conflict');
        return previous.promise;
      }
      const promise = initiate(snapshot);
      inFlight.set(snapshot.reference, { input: identity, promise });
      try { return await promise; }
      finally { inFlight.delete(snapshot.reference); }
    },
    async check(reference: string): Promise<PayoutCheck> {
      const result = await client.getPayout(customerProfileId, reference);
      if (result && result.reference !== reference && result.providerRef !== reference) {
        throw new StraitsxSandboxError('payout lookup reference mismatch');
      }
      return result ?? { status: 'pending', raw: 'not_found' };
    },
  };
}
