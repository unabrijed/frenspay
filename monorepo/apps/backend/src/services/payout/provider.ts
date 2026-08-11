// provider.ts — the fiat-payout provider abstraction + registry, cloned from services/bridge
// (interface + config-selected registry + poller-authoritative advance; docs/08's shape applied to
// the fiat leg). A provider is one API that can disburse a corridor's currency. An LP row opts in
// with sim_behavior = 'psp'; the order worker (simMerchant.ts) then drives the leg through here and
// completes into the SAME claimOrderPayout CAS a human merchant uses — a PSP is an automated real
// merchant whose "UTR" is the provider's payout id. Webhooks are a fast hint; the worker poll is
// authoritative (the Helius/Didit contract).
//
// Sandbox posture (docs/11): providers activate only when their key is configured — with no key the
// registry is empty, 'psp' LPs escalate like a silent merchant, and nothing real can ever move.
import { config } from '../../envConfig';

import { xendit } from './providers/xendit';

export type PayoutStatus = 'pending' | 'paid' | 'failed';

export interface PayoutProvider {
  id: string;
  /** Which payout rails this provider can disburse on (e.g. QRIS). */
  serves(payoutMethod: string): boolean;
  /**
   * Ensure a disbursement exists for the order — idempotent by `reference` (the order's public
   * reference_code doubles as the provider-side idempotency/reference id).
   */
  initiate(input: {
    reference: string;
    /** Canonical decimal string of the fiat leg + its ISO 4217 currency. */
    amountFiat: string;
    currency: string;
    /** The payout destination off the QR (QRIS NMID). */
    destination: string;
    name?: string;
  }): Promise<void>;
  /** Authoritative status by reference. 'paid' → the worker claims the payout. */
  check(reference: string): Promise<PayoutStatus>;
}

const PROVIDERS: PayoutProvider[] = config.xenditSecretKey ? [xendit] : [];

/** The provider serving a rail, or null (no key configured / rail unserved) — caller escalates. */
export function payoutProviderFor(payoutMethod: string): PayoutProvider | null {
  return PROVIDERS.find((p) => p.serves(payoutMethod)) ?? null;
}
