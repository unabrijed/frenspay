// provider.ts — the fiat-payout provider abstraction + DB-backed registry (docs/23).
//
// One vendor is NOT one provider: each live country is its own vendor account with its own
// credentials, so `payout_providers` rows (id/adapter/rail/priority/enabled) decide WHO serves a
// corridor and in what order, while adapters stay code and credentials stay env
// (config.payoutSecretKeys, keyed by row id). Membership requires the credential to resolve AND
// the row to be enabled — a DB row is never sufficient to move money (invariant 11): a keyless
// enabled row is skipped with a loud log, never "in the registry but erroring". The sim adapter
// is excluded from the map in production outright (the KYC "prod must never self-promote" rule).
//
// The worker drives the leg through here and completes into the SAME claimOrderPayout CAS a human
// merchant uses. Webhooks are a fast hint; the worker poll is authoritative (the Helius/Didit
// contract). Status semantics are vendor-agnostic but preserve the two distinctions the worker's
// safety rules need (invariant 12): 'failed' = terminal, money never moved (failover-safe);
// 'reversed' = money moved and came back (freeze, never fail over).
import { PublicKey } from '@solana/web3.js';

import { config } from '../../envConfig';
import { getPayoutProviderRow, listPayoutProviderRows, type PayoutProviderRow } from '../../db/queries';

import { makeSimPayout } from './providers/sim';
import { makeXendit } from './providers/xendit';

export type PayoutStatus = 'pending' | 'paid' | 'failed' | 'reversed';

export interface PayoutCheck {
  status: PayoutStatus;
  /** The vendor's own payout id — persisted on the order; the only evidence that reconstructs a
   *  post-mortem or an orphaned-disbursement record. */
  providerRef?: string;
  /** The vendor's raw status string, for order_events — normalization must not erase it. */
  raw?: string;
}

export interface PayoutProvider {
  /** The registry row id ('xendit_id', 'sim') — also the env credential key and the webhook path. */
  id: string;
  /** Ensure a disbursement exists — idempotent by `reference` (the order's reference_code). */
  initiate(input: {
    reference: string;
    /** Canonical decimal string of the fiat leg + its ISO 4217 currency. */
    amountFiat: string;
    currency: string;
    /** The payout destination off the QR (QRIS NMID). */
    destination: string;
    name?: string;
  }): Promise<void>;
  /** Authoritative status by reference. 'paid' → the worker claims through the CAS. */
  check(reference: string): Promise<PayoutCheck>;
}

/** A value like `<your key>` is set-but-unusable (same rule as services/kyc assertKycConfig). */
const usableSecret = (value: string): boolean => {
  const v = value.trim();
  return v.length > 0 && !/[<>]|your[-_ ]/i.test(v);
};

// Adapter allowlist lives in CODE — a DB string can select among these, never add to them.
// Each factory returns null when its credential doesn't resolve (the row is then inert).
const ADAPTERS: Record<string, (row: PayoutProviderRow) => PayoutProvider | null> = {
  xendit: (row) => {
    const key = config.payoutSecretKeys[row.id];
    return key && usableSecret(key) ? makeXendit(row.id, key) : null;
  },
  // The zero-key dev/demo payer. Never available in production, whatever the DB says.
  ...(config.isProduction ? {} : { sim: (row) => makeSimPayout(row.id) }),
};

function instantiate(row: PayoutProviderRow, log?: (m: string) => void): PayoutProvider | null {
  const factory = ADAPTERS[row.adapter];
  if (!factory) {
    log?.(`payout provider ${row.id}: adapter '${row.adapter}' not in the code allowlist — skipped`);
    return null;
  }
  const provider = factory(row);
  if (!provider && row.enabled) {
    // Enabled-but-inert is exactly the "configured but silently ignored" class — say it loudly.
    log?.(`payout provider ${row.id}: enabled but its credential is unset/placeholder — skipped (inert)`);
  }
  return provider;
}

/**
 * The next provider serving a rail, excluding ids already tried on this order, or null (nothing
 * enabled+credentialed left) — caller escalates. Priority asc, ties by id: a total order, so the
 * tried set makes "next" well-defined.
 */
export async function payoutProviderFor(
  payoutMethod: string,
  excludeIds: readonly string[] = [],
  log?: (m: string) => void,
): Promise<PayoutProvider | null> {
  const rows = await listPayoutProviderRows(payoutMethod, excludeIds);
  for (const row of rows) {
    const provider = instantiate(row, log);
    if (provider) return provider;
  }
  return null;
}

/**
 * The provider a sticky order is bound to — found even when its row is DISABLED: disable affects
 * selection only, and an in-flight leg must keep polling the account that may hold its money
 * (invariant 13). Null only if the row vanished or its credential no longer resolves.
 */
export async function payoutProviderById(id: string, log?: (m: string) => void): Promise<PayoutProvider | null> {
  const row = await getPayoutProviderRow(id);
  return row ? instantiate(row, log) : null;
}

/** Fail fast at boot (server.ts, beside assertKycConfig): a typo'd release destination must not
 *  wait for the first escrow release to surface — in the provider model the fiat leaves first. */
export function assertPayoutConfig(): void {
  if (config.platformTreasuryAddress) {
    new PublicKey(config.platformTreasuryAddress); // throws on garbage
    console.log(`[payout] platform treasury: ${config.platformTreasuryAddress}`);
  }
  const resolved = Object.entries(config.payoutSecretKeys)
    .filter(([, v]) => v && usableSecret(v))
    .map(([k]) => k);
  console.log(`[payout] credentialed providers: ${resolved.join(', ') || '(none)'}${config.isProduction ? '' : ' + sim'}`);
}
