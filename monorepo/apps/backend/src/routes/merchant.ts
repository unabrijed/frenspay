// merchant.ts — the REAL (human) merchant/LP side of the off-ramp.
//
// Until now every LP was a simulation: `simMerchant.ts` played the fiat leg and no one recorded who
// the rupees were actually for. These routes give a person the other half of the trade — see the
// order with the payee's real UPI ID, pay it out-of-band, report it, and get the escrow released
// once a dispute window closes. Their stake (`bond_usdc`) is what makes that trustable: an upheld
// dispute draws it down, and dropping below MIN_BOND auto-suspends them out of routing.
//
// The fiat leg is NOT integrated with any payout rail — the merchant types a UTR by hand. That keeps
// this inside the "simulated rails" posture of docs/11 (no real fiat moves, so no payout licensing).
import type { FastifyInstance } from 'fastify';

import type {
  MerchantOrder,
  MerchantOrdersResponse,
  MerchantProfile,
  PayoutMethod,
  PrepareTransferResponse,
  StakePrepareRequest,
  SubmitPayoutRequest,
} from '@fpay/shared';
import { PublicKey } from '@solana/web3.js';

import { requireMerchant, requireUserId } from '../auth';
import { config } from '../envConfig';
import {
  cancelStakeWithdrawal,
  claimOrderPayout,
  createPendingTransfer,
  getMerchantForUser,
  getUserKycTier,
  getWalletForUser,
  insertMerchantApplication,
  listMerchantOrders,
  listStakeWithdrawals,
  requestStakeWithdrawal,
  setMerchantFloat,
  setMerchantOnlineSelf,
  setMerchantSpread,
  type MerchantOrderRow,
  type MerchantRow,
  type StakeWithdrawalRow,
} from '../db/queries';
import { amt, nonNegativeAmount, positiveAmount, USDC_DECIMALS } from '../lib/amount';
import { acceptsLps, CORRIDORS, PAYOUT_METHODS } from '../lib/corridors';
import { formatAmount } from '../lib/units';
import { KYC_APPROVED_TIER } from '../services/kyc';
import { DISPUTE_WINDOW_MS } from '../services/orderMachine';
import { leverageFor, MIN_BOND } from '../services/merchantStats';
import { buildUsdcTransfer } from '../services/solana';

/** Cap on a single stake deposit — a typo shouldn't be able to move a merchant's whole balance. */
const MAX_STAKE_DEPOSIT_USD = 50_000;

/**
 * Band an LP may price inside, in basis points off the mid. The floor is not zero: a zero-spread LP
 * wins every `cost` comparison in routing, takes the flow, and then has no margin to absorb the FX
 * drift they're carrying (docs/06 — the FX window is ~24h, the quote's is 45s). The ceiling stops a
 * lone LP on a thin corridor from quoting a punitive rate to a payer who cannot see the spread.
 */
const MIN_SPREAD_BPS = 10;
const MAX_SPREAD_BPS = 300;

export function toMerchantProfile(m: MerchantRow, pending?: StakeWithdrawalRow): MerchantProfile {
  return {
    id: m.id,
    name: m.name,
    kybStatus: m.kyb_status,
    status: m.status,
    payoutRail: m.payout_rail,
    treasuryAddress: m.treasury_address,
    country: m.country,
    bondUsdc: m.bond_usdc,
    minBondUsdc: formatAmount(amt(MIN_BOND), USDC_DECIMALS),
    floatUsdc: m.float_usdc,
    // What routing will actually let them carry. Shown so a capped LP can see the reason is their
    // stake, not a silent haircut — `floatUsdc` alone made the cap look like a bug.
    maxFloatUsdc: formatAmount(amt(Number(m.bond_usdc)).times(leverageFor(m.tier)), USDC_DECIMALS),
    tier: m.tier,
    spreadBps: m.spread_bps,
    pendingWithdrawal: pending
      ? { id: pending.id, amountUsdc: pending.amount_usdc, requestedAt: pending.requested_at.toISOString() }
      : undefined,
    successRate: Number(m.success_rate),
    disputeRate: Number(m.dispute_rate),
    positiveRate: Number(m.positive_rate),
  };
}

function toMerchantOrder(r: MerchantOrderRow): MerchantOrder {
  return {
    id: r.id,
    referenceCode: r.reference_code,
    state: r.state,
    resolution: r.resolution,
    currency: r.currency,
    amountInr: r.amount_inr,
    amountUsdc: r.amount_usdc,
    payoutDestination: r.payout_destination ?? undefined,
    payoutName: r.payout_name ?? undefined,
    payoutMethod: r.payout_method,
    payoutUtr: r.payout_utr ?? undefined,
    payoutClaimedAt: r.payout_claimed_at?.toISOString(),
    expiresAt: r.expires_at?.toISOString(),
    createdAt: r.created_at.toISOString(),
  };
}

export async function registerMerchantRoutes(app: FastifyInstance) {
  /**
   * Onboarding: apply to become an LP (pending KYB, offline until approved).
   *
   * This was previously UNAUTHENTICATED, which was a live hole — anonymous callers could insert
   * unbounded merchant rows, and every row is walked by `recomputeMerchantStats` on the same
   * confirmer tick that drives the order worker. Worse, `isMerchantTreasuryAddress` is used to
   * REJECT send recipients, so registering someone else's address as a treasury would permanently
   * block fpay sends to it.
   */
  app.post<{ Body: { name?: string; payoutMethod?: PayoutMethod; treasuryAddress?: string } }>(
    '/merchants/apply',
    async (req, reply) => {
      const userId = requireUserId(req);
      // Merchant KYC: the human behind the merchant must be identity-verified (the same personal
      // tier-2 KYC that gates cash-out). KYB approval is a separate, later step on top of this.
      if ((await getUserKycTier(userId)) < KYC_APPROVED_TIER) {
        return reply.code(403).send({ error: 'kyc_required' });
      }
      const { name, payoutMethod, treasuryAddress } = req.body ?? {};
      const rail = payoutMethod ?? 'UPI';
      if (!name || !treasuryAddress) return reply.code(400).send({ error: 'missing_fields' });
      if (!PAYOUT_METHODS.includes(rail)) return reply.code(400).send({ error: 'invalid_rail' });
      // A corridor that never falls back to the pool has no LP network to join. Note this is now a
      // narrower rejection than "the corridor prefers a provider": QRIS prefers Xendit AND keeps an
      // LP fallback, so Indonesian LPs may now register — that fallback pool cannot exist if the
      // door is shut on them.
      if (!acceptsLps(rail)) {
        return reply.code(400).send({ error: 'rail_not_open_to_lps' });
      }
      // The corridor is the country authority, mirroring rails.ts (invariant 1). Not taken from the
      // request and not from users.country: an LP declaring their own country would be declaring
      // which orders they can be offered, and users.country is a display preference that the money
      // paths deliberately never read (docs/18).
      const country = CORRIDORS[rail]?.country;
      if (!country) return reply.code(400).send({ error: 'invalid_rail' });
      try {
        new PublicKey(treasuryAddress); // release target — must be a valid Solana address
      } catch {
        return reply.code(400).send({ error: 'invalid_treasury_address' });
      }
      if (await getMerchantForUser(userId)) return reply.code(409).send({ error: 'already_a_merchant' });
      const id = await insertMerchantApplication({ userId, name, payoutRail: rail, treasuryAddress, country });
      return reply.code(201).send({ id, kybStatus: 'pending' });
    },
  );

  /** The merchant's work queue: orders routed to them, newest first. */
  app.get('/merchants/orders', async (req): Promise<MerchantOrdersResponse> => {
    const merchant = await requireMerchant(req);
    const rows = await listMerchantOrders(merchant.id);
    return { orders: rows.map(toMerchantOrder) };
  });

  /**
   * "I've paid" — the merchant reports settling the fiat leg out-of-band.
   *
   * Deliberately does NOT move the order to a new state: it stays `payment_detected` (the money is
   * still escrowed and the LP still owes it) and gains `payout_utr` + `payout_claimed_at`. The
   * guarded UPDATE inside `claimOrderPayout` IS the compare-and-set, so a double-tap is idempotent
   * and an order that was rerouted/refunded out from under them can't be claimed.
   */
  app.post<{ Params: { id: string }; Body: SubmitPayoutRequest }>(
    '/merchants/orders/:id/paid',
    async (req, reply) => {
      const merchant = await requireMerchant(req);
      if (merchant.kyb_status !== 'approved') return reply.code(403).send({ error: 'kyb_not_approved' });
      const reference = req.body?.reference?.trim();
      if (!reference) return reply.code(400).send({ error: 'missing_reference' });
      if (reference.length > 64) return reply.code(400).send({ error: 'reference_too_long' });
      const claimed = await claimOrderPayout({
        orderId: req.params.id,
        merchantId: merchant.id,
        reference,
        windowMs: DISPUTE_WINDOW_MS,
      });
      // 409 rather than 404: the order exists, it just isn't claimable (already claimed, released,
      // refunded, or reassigned to another LP by the failover path).
      if (!claimed) return reply.code(409).send({ error: 'order_not_claimable' });
      return { ok: true, releasesInSecs: Math.round(DISPUTE_WINDOW_MS / 1000) };
    },
  );

  /** Set how much the LP can carry in flight — their own honest capacity, not their stake.
   *  Routing takes min(this, bond × leverage), so declaring more than the stake backs buys nothing. */
  app.post<{ Body: { floatUsd?: number } }>('/merchants/float', async (req, reply) => {
    const merchant = await requireMerchant(req);
    // Zero is a legitimate float — an LP throttling themselves without going offline.
    const floatUsd = nonNegativeAmount(req.body?.floatUsd);
    if (floatUsd === null) return reply.code(400).send({ error: 'invalid_amount' });
    await setMerchantFloat(merchant.id, floatUsd);
    return { ok: true, floatUsdc: floatUsd };
  });

  /**
   * Go online / offline. The LP's own switch — until now `merchants.status` was writable only by an
   * admin, and the documented workaround was setting float to 0, which is a different statement
   * ("I have no capacity" vs "I'm not here") that routing and the LP's own dashboard both misread.
   *
   * The guard lives in the UPDATE (`setMerchantOnlineSelf`): 'suspended' is neither reachable nor
   * escapable here, and coming online re-checks KYB + the bond floor, so this can't be used as a
   * side door around the routing gate.
   */
  app.post<{ Body: { online?: boolean } }>('/merchants/status', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (typeof req.body?.online !== 'boolean') return reply.code(400).send({ error: 'missing_fields' });
    const status = req.body.online ? 'online' : 'offline';
    if (!(await setMerchantOnlineSelf(merchant.id, status, MIN_BOND))) {
      // Say which wall they hit — "refused" with no reason is the kind of thing an LP files a
      // support ticket about.
      if (merchant.status === 'suspended') return reply.code(409).send({ error: 'merchant_suspended' });
      if (merchant.kyb_status !== 'approved') return reply.code(409).send({ error: 'kyb_not_approved' });
      return reply.code(409).send({ error: 'bond_below_minimum' });
    }
    return { ok: true, status };
  });

  /**
   * Set the LP's own spread, in basis points off the mid rate.
   *
   * This had no writer at all outside the seed: every real LP was pinned to the column default of
   * 50 bps forever, unable to compete on the one axis that is genuinely theirs — while `cost`
   * carries 0.20 of the routing score and the spread IS their entire revenue.
   */
  app.post<{ Body: { spreadBps?: number } }>('/merchants/spread', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const bps = req.body?.spreadBps;
    if (!Number.isInteger(bps)) return reply.code(400).send({ error: 'invalid_amount' });
    if (bps! < MIN_SPREAD_BPS || bps! > MAX_SPREAD_BPS) {
      return reply.code(400).send({ error: 'spread_out_of_band', minBps: MIN_SPREAD_BPS, maxBps: MAX_SPREAD_BPS });
    }
    await setMerchantSpread(merchant.id, bps!);
    return { ok: true, spreadBps: bps };
  });

  /**
   * Stake: build a USDC transfer from the merchant's own wallet to the stake treasury. Reuses the
   * ordinary prepare/sign/submit seam — the client signs this and then calls the EXISTING
   * `/transfer/submit` (which is scoped to `from_user_id`, so it accepts any transfer the caller
   * owns). The bond is credited only when the transfer CONFIRMS, in `onTransferConfirmedAndNotify`.
   *
   * `kind` stays 'send' on purpose: this is real USDC leaving the merchant's wallet, which is exactly
   * what the rolling daily send cap measures. A bespoke kind would silently escape that cap.
   */
  app.post<{ Body: StakePrepareRequest }>('/merchants/stake/prepare', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (!config.stakeTreasuryAddress) return reply.code(503).send({ error: 'staking_unavailable' });
    const amountUsd = positiveAmount(req.body?.amountUsd);
    if (amountUsd === null) return reply.code(400).send({ error: 'invalid_amount' });
    if (amountUsd > MAX_STAKE_DEPOSIT_USD) return reply.code(400).send({ error: 'amount_too_large' });

    const wallet = await getWalletForUser(merchant.user_id!);
    if (!wallet) return reply.code(404).send({ error: 'wallet_not_found' });

    let built: { unsignedTx: string; feePayer: string };
    try {
      built = await buildUsdcTransfer({
        fromOwner: wallet.address,
        toOwner: config.stakeTreasuryAddress,
        amountUsd,
      });
    } catch (e) {
      req.log.error({ err: e }, 'stake transfer build failed');
      return reply.code(503).send({ error: 'solana_unavailable' });
    }
    const { id: transferId } = await createPendingTransfer({
      fromUserId: merchant.user_id!,
      toUserId: null,
      fromAddress: wallet.address,
      toAddress: config.stakeTreasuryAddress,
      amountUsd,
      kind: 'send',
      note: 'merchant stake',
    });
    return { unsignedTx: built.unsignedTx, feePayer: built.feePayer, transferId } satisfies PrepareTransferResponse;
  });

  /**
   * Ask for stake back — the way OUT, which did not exist. `bond_usdc` could only ever be credited
   * on a confirmed deposit or fined down by a dispute, which makes staking a one-way door.
   *
   * This is a REQUEST, not a transfer, and deliberately so: `STAKE_TREASURY_ADDRESS` is a public key
   * with no signer (envConfig.ts:106-110 — "add a secret key here only when merchants can offboard
   * and withdraw"). Automating the release means putting a second hot key in env, which is its own
   * security decision and not one to make as a side effect of this. A human releases it from the
   * admin console.
   *
   * The bond is debited HERE, not at release. Money an LP has asked to withdraw must stop backing
   * new orders immediately; every precondition (no open request, nothing in flight, no open dispute,
   * enough bond) is a predicate inside the one statement, so two concurrent requests cannot both win.
   */
  app.post<{ Body: { amountUsd?: string | number } }>('/merchants/stake/withdraw', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const amountUsd = positiveAmount(req.body?.amountUsd);
    if (amountUsd === null) return reply.code(400).send({ error: 'invalid_amount' });

    const id = await requestStakeWithdrawal(merchant.id, amountUsd);
    if (!id) {
      // One refusal for four causes would be useless to the person reading it, so re-read and say
      // which. Racy by nature — this is an error message, not a gate; the gate is the statement above.
      const open = (await listStakeWithdrawals(merchant.id)).find((w) => w.status === 'requested');
      if (open) return reply.code(409).send({ error: 'withdrawal_already_pending' });
      if (Number(merchant.bond_usdc) < amountUsd) return reply.code(409).send({ error: 'insufficient_bond' });
      return reply.code(409).send({ error: 'orders_in_flight' });
    }
    return reply.code(201).send({ id, amountUsdc: formatAmount(amt(amountUsd), USDC_DECIMALS) });
  });

  /** Changed their mind before a human released it — the bond goes straight back. */
  app.post<{ Params: { id: string } }>('/merchants/stake/withdraw/:id/cancel', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (!(await cancelStakeWithdrawal(merchant.id, req.params.id))) {
      return reply.code(409).send({ error: 'withdrawal_not_cancellable' });
    }
    return { ok: true };
  });
}
