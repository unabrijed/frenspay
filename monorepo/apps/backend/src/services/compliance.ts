// compliance.ts — M5 KYC tier limits + risk/screening. The cosmetic tiers become real: per-tier caps
// on money movement, a simulated sanctions denylist, and a simple per-action fraud score with an audit
// trail. Simulated rails — tier upgrades + screening are sim (no real KYC/AML vendor; that lands at M7).
import { config } from '../envConfig';

import {
  canonicalHandle,
  getUserKycTier,
  insertRiskEvent,
  isDenylisted,
  recentCashOutVolumeUsd,
  recentSendVolumeUsd,
} from '../db/queries';

export interface TierLimits {
  label: string;
  sendPerTx: number;
  sendDaily: number;
  cashOut: boolean;
  cashOutPerTx: number;
  cashOutDaily: number;
}

// Mirrors the Verify UI: tier 1 = P2P up to $100/tx; tier 2 unlocks merchant pay; tier 3 enhanced.
export const KYC_TIERS: Record<number, TierLimits> = {
  0: { label: 'Restricted', sendPerTx: 0, sendDaily: 0, cashOut: false, cashOutPerTx: 0, cashOutDaily: 0 },
  1: { label: 'Basic', sendPerTx: 100, sendDaily: 300, cashOut: false, cashOutPerTx: 0, cashOutDaily: 0 },
  2: { label: 'Verified', sendPerTx: 1000, sendDaily: 5000, cashOut: true, cashOutPerTx: 1000, cashOutDaily: 5000 },
  3: { label: 'Enhanced', sendPerTx: 10000, sendDaily: 50000, cashOut: true, cashOutPerTx: 10000, cashOutDaily: 50000 },
};
export const MAX_TIER = 3;

export function tierLimits(tier: number): TierLimits {
  return KYC_TIERS[tier] ?? KYC_TIERS[0];
}

/**
 * The caps a decision is actually made against.
 *
 * With the identity vendor off (`config.personaLive` false — credentials blanked in the host's
 * panel) NOBODY can reach tier 2, so a tier-2 cash-out gate closes scan-and-pay for every user
 * permanently. Same rule as /merchants/apply (routes/merchant.ts): the GATE lifts, the CAPS do not
 * — a tier-1 user pays partners under the same $100/tx, $300/day they can already send. The gate
 * re-imposes itself the moment the credentials come back; nothing here needs redeploying.
 *
 * KYC_TIERS itself is deliberately left alone: unlocking cash-out in the table would keep tier 1
 * unlocked AFTER the vendor returns, which is the opposite of what this is for.
 *
 * `vendorLive` is a parameter so both branches can be asserted in one process (check-compliance.ts);
 * every production caller takes the default.
 */
export function effectiveLimits(tier: number, vendorLive = config.personaLive): TierLimits {
  const l = tierLimits(tier);
  if (vendorLive || l.cashOut) return l;
  return { ...l, cashOut: true, cashOutPerTx: l.sendPerTx, cashOutDaily: l.sendDaily };
}

export type LimitCheck =
  | { ok: true }
  | { ok: false; kind: 'send' | 'cash_out'; currentTier: number; requiredTier: number; limitUsd: number; reason: string };

const WINDOW_HOURS = 24;

/** The smallest tier whose caps actually clear this amount (+ rolling `used`), so the "verify to tier
 *  N" prompt always unblocks the user. Falls back to MAX_TIER. */
function smallestTierFor(kind: 'send' | 'cash_out', amountUsd: number, used: number): number {
  for (let t = 0; t <= MAX_TIER; t++) {
    const l = KYC_TIERS[t];
    if (kind === 'send') {
      if (l.sendPerTx >= amountUsd && l.sendDaily >= used + amountUsd) return t;
    } else if (l.cashOut && l.cashOutPerTx >= amountUsd && l.cashOutDaily >= used + amountUsd) {
      return t;
    }
  }
  return MAX_TIER;
}

/** Enforce P2P send limits (tier + per-tx + rolling-24h daily). */
export async function checkSendLimit(userId: string, amountUsd: number): Promise<LimitCheck> {
  const tier = await getUserKycTier(userId);
  const lim = tierLimits(tier);
  const used = await recentSendVolumeUsd(userId, WINDOW_HOURS);
  if (lim.sendPerTx <= 0) {
    return { ok: false, kind: 'send', currentTier: tier, requiredTier: 1, limitUsd: 0, reason: 'sending is not enabled for your account' };
  }
  if (amountUsd > lim.sendPerTx) {
    return { ok: false, kind: 'send', currentTier: tier, requiredTier: smallestTierFor('send', amountUsd, used), limitUsd: lim.sendPerTx, reason: `over the $${lim.sendPerTx} per-transfer limit` };
  }
  if (used + amountUsd > lim.sendDaily) {
    return { ok: false, kind: 'send', currentTier: tier, requiredTier: smallestTierFor('send', amountUsd, used), limitUsd: lim.sendDaily, reason: `over the $${lim.sendDaily} daily limit` };
  }
  return { ok: true };
}

/** Enforce merchant cash-out limits (requires a verified tier + per-tx + rolling-24h daily). */
export async function checkCashOutLimit(userId: string, amountUsd: number): Promise<LimitCheck> {
  const tier = await getUserKycTier(userId);
  const lim = effectiveLimits(tier);
  const used = await recentCashOutVolumeUsd(userId, WINDOW_HOURS);
  if (!lim.cashOut) {
    return { ok: false, kind: 'cash_out', currentTier: tier, requiredTier: smallestTierFor('cash_out', amountUsd, used), limitUsd: 0, reason: 'verify your identity to pay merchants' };
  }
  if (amountUsd > lim.cashOutPerTx) {
    return { ok: false, kind: 'cash_out', currentTier: tier, requiredTier: smallestTierFor('cash_out', amountUsd, used), limitUsd: lim.cashOutPerTx, reason: `over the $${lim.cashOutPerTx} per-payment limit` };
  }
  if (used + amountUsd > lim.cashOutDaily) {
    return { ok: false, kind: 'cash_out', currentTier: tier, requiredTier: smallestTierFor('cash_out', amountUsd, used), limitUsd: lim.cashOutDaily, reason: `over the $${lim.cashOutDaily} daily limit` };
  }
  return { ok: true };
}

/** Sanctions/denylist screening (simulated). EVM addresses are case-insensitive hex (EIP-55
 *  checksumming re-cases them), so an exact-match lookup is trivially bypassed by case variation —
 *  normalize to lowercase before matching (denylist rows for 0x addresses must be seeded lowercase).
 *  Solana base58 is case-significant: match exact. */
export function screenAddress(address: string): Promise<boolean> {
  const normalized = address.startsWith('0x') ? address.toLowerCase() : address;
  return isDenylisted('address', normalized);
}
export function screenHandle(handle: string): Promise<boolean> {
  // Canonical form ('@' + lowercase) so '@Sanctioned' can't sidestep a denylist row seeded
  // canonically; uncanonicalizable input screens as-typed (it can't resolve to a user anyway).
  return isDenylisted('handle', canonicalHandle(handle) ?? handle);
}

/**
 * Per-action fraud score → decision, recorded for the audit trail. Simulated heuristics: a denylisted
 * counterparty blocks; an amount near the tier cap flags for review; otherwise allow.
 */
export async function scoreAndRecord(input: {
  userId: string;
  kind: 'send' | 'cash_out' | 'deposit';
  amountUsd: number;
  denylisted?: boolean;
  /** Who the money is going to (handle or raw address) — recorded for the audit trail. */
  counterparty?: string;
  /** Recipient is a raw wallet outside fpay (unhosted-wallet withdrawal — higher risk class). */
  externalRecipient?: boolean;
}): Promise<{ decision: 'allow' | 'review' | 'block'; score: number; reason: string }> {
  const reasons: string[] = [];
  let score = 0;
  if (input.denylisted) {
    score += 100;
    reasons.push('denylisted counterparty');
  }
  if (input.externalRecipient) {
    score += 15;
    reasons.push('external wallet destination');
  }
  const lim = effectiveLimits(await getUserKycTier(input.userId));
  const cap = input.kind === 'send' ? lim.sendPerTx : lim.cashOutPerTx;
  // money:number — a risk-scoring threshold, not a ledger amount. Compliance compares and scores;
  // it never moves money, so a 1-ulp difference only shifts a score at an exact cap boundary.
  if (cap > 0 && input.amountUsd > cap * 0.8) {
    score += 40;
    reasons.push('large relative to tier cap');
  }
  const decision = score >= 100 ? 'block' : score >= 40 ? 'review' : 'allow';
  const reason = reasons.join('; ') || 'ok';
  await insertRiskEvent({
    userId: input.userId,
    kind: input.kind,
    amountUsd: input.amountUsd,
    decision,
    score,
    reason,
    counterparty: input.counterparty,
  });
  return { decision, score, reason };
}
