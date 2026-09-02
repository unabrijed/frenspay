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
import type { FastifyInstance, FastifyReply } from 'fastify';

import type {
  MerchantOrder,
  MerchantLedgerResponse,
  MerchantOrdersResponse,
  MerchantProfile,
  MerchantStakeClaimsResponse,
  PayoutMethod,
  PrepareTransferResponse,
  StakeClaim,
  StakeClaimRequest,
  StakePrepareRequest,
  SubmitPayoutRequest,
} from '@fpay/shared';
import { PublicKey } from '@solana/web3.js';

import { requireMerchant, requireUserId } from '../auth';
import { config } from '../envConfig';
import {
  cancelStakeWithdrawal,
  createPendingTransfer,
  getMerchantForUser,
  getUserKycTier,
  getWalletForUser,
  appendKybEvent,
  insertMerchantApplication,
  insertStakeClaim,
  listStakeClaimsForMerchant,
  type StakeClaimRow,
  listMerchantDisputes,
  normalizePhone,
  setMerchantContactPhone,
  merchantEarnings,
  submitMerchantKyb,
  setMerchantAlertChannel,
  listStakeWithdrawals,
  requestStakeWithdrawal,
  setStakeWithdrawalAddress,
  type KybEventRow,
  type MerchantOrderRow,
  type MerchantRow,
  type StakeWithdrawalRow,
  exitMerchant,
  hasRecentCompletion,
} from '../db/queries';
import { amt, positiveAmount, USDC_DECIMALS } from '../lib/amount';
import { acceptsLps, CORRIDORS, PAYOUT_METHODS } from '../lib/corridors';
import { KYB_SUBMITTABLE, validateKybFields } from '../lib/kyb';
import { formatAmount } from '../lib/units';
import { KYC_APPROVED_TIER } from '../services/kyc';
import * as ops from '../services/merchantOps';
import { DISPUTE_CLAW_WINDOW_H, leverageFor, MIN_BOND, spreadCapFor, tierProgress } from '../services/merchantStats';
import { buildUsdcTransfer, isOperationalAddress, isValidRecipientOwner, SIGNATURE_RE } from '../services/solana';
import { readStakeDeposit } from '../services/transferVerify';

/** Cap on a single stake deposit — a typo shouldn't be able to move a merchant's whole balance. */
const MAX_STAKE_DEPOSIT_USD = 50_000;

/** Adapters services/alert knows how to reach. Validated here so an LP can't store an address for a
 *  channel that will never fire and then wonder why they hear nothing. */
const ALERT_CHANNELS: readonly string[] = ['telegram'];

/**
 * How each merchantOps refusal answers over HTTP. The ops themselves are transport-blind (the
 * Telegram bot maps the same errors to chat copy); this record is the routes' entire share of the
 * old handler logic. 409 default: "the thing exists, it just isn't in a state you can act on".
 */
const ERR_STATUS: Record<string, number> = {
  kyb_not_approved: 403,
  lock_temporarily_blocked: 429,
  missing_reference: 400,
  invalid_reference: 400,
  invalid_amount: 400,
  spread_out_of_band: 400,
};

/** `force` pins the status for an op whose refusals all mean "the row exists, it just isn't in a
 *  state that can do this" — even when the same error string means "forbidden" elsewhere.
 *  /merchants/status answered 409 for kyb_not_approved (deliberately grouped with
 *  merchant_suspended and bond_below_minimum) while lock and paid answer 403 for it. */
function refuse(reply: FastifyReply, r: { error: string; extra?: Record<string, number> }, force?: number) {
  return reply.code(force ?? ERR_STATUS[r.error] ?? 409).send({ error: r.error, ...r.extra });
}

export function toMerchantProfile(
  m: MerchantRow,
  pending?: StakeWithdrawalRow,
  kybEvents?: KybEventRow[],
  settled?: number,
  payoutWallet?: string,
): MerchantProfile {
  return {
    id: m.id,
    name: m.name,
    // Why a suspended row is suspended: 'exited' is the LP's own decision and final; anything else
    // is the bond floor or a human, and the console words them differently.
    suspendReason: m.suspend_reason ?? undefined,
    exitedAt: m.exited_at?.toISOString(),
    // The DEFAULT destination for a released stake — their fpay wallet. The partner may name another
    // when they ask (pendingWithdrawal.payoutAddress); this is what that prompt is prefilled with.
    payoutWallet,
    clawWindowHours: DISPUTE_CLAW_WINDOW_H,
    kybStatus: m.kyb_status,
    // The reviewer's outstanding question or reason, shown to the merchant verbatim. "Rejected"
    // with nothing after it is not a decision anyone can act on.
    kybNote: m.kyb_note ?? undefined,
    // Echoed back so a more-info request re-opens the form already filled in, rather than asking
    // someone to retype seven fields to fix one.
    kybFields: m.kyb_fields ?? undefined,
    kybSubmittedAt: m.kyb_submitted_at?.toISOString(),
    kybEvents: kybEvents?.map((e) => ({
      fromStatus: e.from_status,
      toStatus: e.to_status,
      event: e.event,
      note: typeof e.detail?.note === 'string' ? e.detail.note : undefined,
      createdAt: e.created_at.toISOString(),
    })),
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
    // Only computable with the settled count, which is one extra read — so callers that don't need
    // the dashboard hero (and don't pass it) simply omit it rather than paying for it.
    tierProgress:
      settled == null
        ? undefined
        : (tierProgress({
            settled,
            successRate: Number(m.success_rate),
            disputeRate: Number(m.dispute_rate),
            avgCompletionSecs: m.avg_completion_secs,
          }) ?? undefined),
    spreadBps: m.spread_bps,
    maxSpreadBps: spreadCapFor(m.tier),
    pendingWithdrawal: pending
      ? {
          id: pending.id,
          amountUsdc: pending.amount_usdc,
          requestedAt: pending.requested_at.toISOString(),
          exit: pending.exit,
          payoutAddress: pending.payout_address ?? undefined,
        }
      : undefined,
    successRate: Number(m.success_rate),
    disputeRate: Number(m.dispute_rate),
    positiveRate: Number(m.positive_rate),
    contactPhone: m.contact_phone ?? undefined,
    contactPhoneVerified: m.contact_phone_verified_at != null,
  };
}

/**
 * A refund destination the partner typed: null for "my fpay wallet", the address when it holds up,
 * undefined when it does not. Held to the same test a plain send's recipient is — an on-curve owner
 * that is not one of ours — because a token account pasted off an explorer, or the treasury itself,
 * would be a refund nobody can spend. A partner's own release address is fine here (a send refuses it).
 */
function parsePayoutAddress(raw: unknown): string | null | undefined {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const a = raw.trim();
  if (!a) return null;
  return isValidRecipientOwner(a) && !isOperationalAddress(a) ? a : undefined;
}

/** Shared with the admin console's view of the same row — the two must read identical words. */
export function toStakeClaim(c: StakeClaimRow): StakeClaim {
  return {
    id: c.id,
    signature: c.signature,
    status: c.status,
    amountUsdc: c.chain.amountUsdc,
    sender: c.chain.sender ?? undefined,
    memo: c.chain.memo ?? undefined,
    paidAt: c.chain.blockTime != null ? new Date(c.chain.blockTime * 1000).toISOString() : undefined,
    transferStatus: c.transfer_status ?? undefined,
    // Only a rejection carries words for the partner; a credit's note is the admin's own.
    note: c.status === 'rejected' ? (c.note ?? undefined) : undefined,
    createdAt: c.created_at.toISOString(),
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
    // Already NULL on anything this LP doesn't hold — listOpenOffers redacts in SQL, so this mapper
    // cannot leak a payee by forgetting to.
    payoutDestination: r.payout_destination ?? undefined,
    payoutName: r.payout_name ?? undefined,
    payoutMethod: r.payout_method,
    payoutUtr: r.payout_utr ?? undefined,
    payoutClaimedAt: r.payout_claimed_at?.toISOString(),
    expiresAt: r.expires_at?.toISOString(),
    createdAt: r.created_at.toISOString(),
    mine: r.mine,
    lockedAt: r.locked_at?.toISOString(),
    lockExpiresAt: r.lock_expires_at?.toISOString(),
    offerWidensAt: r.offer_widens_at?.toISOString(),
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
  app.post<{ Body: { name?: string; payoutMethod?: PayoutMethod; treasuryAddress?: string; contactPhone?: string } }>(
    '/merchants/apply',
    async (req, reply) => {
      const userId = requireUserId(req);
      // Partner KYC: the human behind the business must be identity-verified (the same personal
      // tier-2 KYC that gates cash-out). KYB approval is a separate, later step on top of this.
      //
      // ...UNLESS the vendor is off (config.personaLive false — credentials blanked in the host's
      // panel). Then nobody can reach tier 2 at all and this gate closes the funnel completely, so the
      // identity check MOVES to the human who reads the business form: an admin KYB approval grants
      // tier 2 itself (routes/admin.ts). One reviewer, one form, one decision — docs/14. The gate
      // re-imposes itself the moment the credentials come back; nothing here needs redeploying.
      if (config.personaLive && (await getUserKycTier(userId)) < KYC_APPROVED_TIER) {
        return reply.code(403).send({ error: 'kyc_required' });
      }
      const { name, payoutMethod, treasuryAddress, contactPhone } = req.body ?? {};
      const rail = payoutMethod ?? 'UPI';
      if (!name || !treasuryAddress) return reply.code(400).send({ error: 'missing_fields' });
      // A number we can reach them on is not optional: when a payout goes wrong the alternative is
      // waiting for them to open the app. Normalized to E.164 here so every consumer gets one shape.
      if (!contactPhone) return reply.code(400).send({ error: 'missing_phone' });
      const phone = normalizePhone(contactPhone);
      if (!phone) return reply.code(400).send({ error: 'invalid_phone' });
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
      const id = await insertMerchantApplication({
        userId,
        name,
        payoutRail: rail,
        treasuryAddress,
        country,
        contactPhone: phone,
      });
      return reply.code(201).send({ id, kybStatus: 'pending' });
    },
  );

  /**
   * The merchant's work queue: their own orders, plus the open pool they could take.
   *
   * Two sets in one response because they are one screen and one poll. `mine` distinguishes them.
   * Eligibility, headroom and payee redaction all live in ops.listWork — this handler only maps.
   */
  app.get('/merchants/orders', async (req): Promise<MerchantOrdersResponse> => {
    const merchant = await requireMerchant(req);
    return { orders: (await ops.listWork(merchant)).map(toMerchantOrder) };
  });

  /** Take an order — the mutual exclusion the whole marketplace turns on, and the moment the
   *  payee is revealed. Exactly one of N concurrent callers gets a 200; the rest get 409. */
  app.post<{ Params: { id: string } }>('/merchants/orders/:id/lock', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const r = await ops.takeOrder(merchant, req.params.id);
    if (!r.ok) return refuse(reply, r);
    return r;
  });

  /** Give it back. Free and unpenalised on purpose: if handing an order back costs the same as
   *  going silent, everyone goes silent and the pool waits out every TTL. */
  app.post<{ Params: { id: string } }>('/merchants/orders/:id/unlock', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const r = await ops.giveBackOrder(merchant, req.params.id);
    if (!r.ok) return refuse(reply, r);
    return r;
  });

  /**
   * Change the number we reach them on. Separate from apply because apply 409s an existing
   * merchant, so this is the only way every provider who onboarded before 0022 ever gets one.
   * Re-typing a number clears any verification it had — a new number is a new claim.
   */
  app.post<{ Body: { phone?: string } }>('/merchants/contact-phone', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const phone = normalizePhone(req.body?.phone ?? '');
    if (!phone) return reply.code(400).send({ error: 'invalid_phone' });
    await setMerchantContactPhone(merchant.id, phone);
    return { ok: true, contactPhone: phone };
  });

  /**
   * Submit (or resubmit) the business details behind this LP.
   *
   * The person may NOT be verified: /merchants/apply requires tier-2 vendor KYC only while the vendor
   * is live (docs/14), and while it is off the human reading this form is the only identity check
   * there is — which is why every country spec carries one `identity: true` field. This is otherwise
   * the BUSINESS: who they trade as, and above all which account the fiat will
   * actually leave from. That last field is the one that matters: the documented failure mode for
   * this entire business shape is third-party money moving through a personal account and the
   * account being frozen (docs/06, docs/08), and knowing which account BEFORE they start is what
   * makes that reviewable instead of discoverable afterwards.
   *
   * Accepted from 'pending' and 'more_info' — the resubmission path is the same call, which is what
   * turns a rejection into a conversation.
   */
  app.post<{ Body: { fields?: Record<string, unknown> } }>('/merchants/kyb', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (!KYB_SUBMITTABLE.includes(merchant.kyb_status)) {
      return reply.code(409).send({ error: 'kyb_not_submittable', kybStatus: merchant.kyb_status });
    }
    // Trust boundary. The client checks the same rules first, purely so a typo doesn't cost a round
    // trip; nothing it says is believed here.
    const checked = validateKybFields(merchant.country, req.body?.fields);
    if (!checked.ok) return reply.code(400).send({ error: 'invalid_kyb_fields', invalid: checked.invalid });

    const from = await submitMerchantKyb(merchant.id, checked.fields, KYB_SUBMITTABLE);
    // Lost a race with a reviewer who moved it mid-request.
    if (from == null) return reply.code(409).send({ error: 'kyb_not_submittable' });
    // The field VALUES deliberately don't go in the event log: they live in merchants.kyb_fields,
    // and copying business identifiers into an append-only table means they can never be corrected
    // or erased. The log records that a submission happened, not what was in it.
    await appendKybEvent(merchant.id, from, 'submitted', 'kyb_submitted', { country: merchant.country });
    return { ok: true, kybStatus: 'submitted' };
  });

  /**
   * The LP's own numbers: what settled to them, and every dispute raised against them.
   *
   * One route for both because they are one screen and one question — "how is this going" — and
   * because a dispute is exactly the thing that makes the earnings figure not the whole story.
   */
  app.get<{ Querystring: { days?: string } }>('/merchants/ledger', async (req): Promise<MerchantLedgerResponse> => {
    const merchant = await requireMerchant(req);
    // Clamped, not trusted: this interpolates into an interval, and an unbounded window is a table
    // scan an LP could ask for on a 15-second poll.
    const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 365);
    const [e, disputes] = await Promise.all([merchantEarnings(merchant.id, days), listMerchantDisputes(merchant.id)]);
    return {
      earnings: {
        windowDays: days,
        settled: e.settled,
        usdcIn: e.usdc_in,
        fiatOut: e.fiat_out,
        // No completed orders yet → no currency to report. Fall back to the corridor's, so the
        // empty state still reads "₹0" rather than "0".
        currency: e.currency ?? CORRIDORS[merchant.payout_rail]?.currency ?? 'INR',
      },
      disputes: disputes.map((d) => ({
        id: d.id,
        orderId: d.order_id,
        referenceCode: d.reference_code,
        reason: d.reason ?? undefined,
        status: d.status as 'open' | 'resolved',
        resolution: (d.resolution as 'upheld' | 'rejected' | null) ?? undefined,
        amountUsdc: d.amount_usdc,
        createdAt: d.created_at.toISOString(),
        resolvedAt: d.resolved_at?.toISOString(),
      })),
    };
  });

  /**
   * Where to reach this LP. The token flow lives on the client: they open the bot, it sends
   * `/start <token>`, and the bot's own webhook calls this with the chat id it learned. Storing the
   * address is all the backend needs to know.
   */
  app.post<{ Body: { channel?: string; address?: string } }>('/merchants/alerts', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const { channel, address } = req.body ?? {};
    if (!channel || !address) return reply.code(400).send({ error: 'missing_fields' });
    if (!ALERT_CHANNELS.includes(channel)) return reply.code(400).send({ error: 'unsupported_channel' });
    await setMerchantAlertChannel(merchant.id, channel, address);
    return { ok: true };
  });

  /** "I've paid" — the merchant reports settling the fiat leg out-of-band. All semantics
   *  (UTR shape, the kyb gate, the claim CAS) live in ops.reportPaid. */
  app.post<{ Params: { id: string }; Body: SubmitPayoutRequest }>(
    '/merchants/orders/:id/paid',
    async (req, reply) => {
      const merchant = await requireMerchant(req);
      const r = await ops.reportPaid(merchant, req.params.id, req.body?.reference);
      if (!r.ok) return refuse(reply, r);
      return r;
    },
  );

  /** Set how much the LP can carry in flight — their own honest capacity, not their stake. */
  app.post<{ Body: { floatUsd?: number } }>('/merchants/float', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const r = await ops.setFloat(merchant, req.body?.floatUsd);
    if (!r.ok) return refuse(reply, r);
    return r;
  });

  /**
   * Go online / offline. The LP's own switch — until now `merchants.status` was writable only by an
   * admin, and the documented workaround was setting float to 0, which is a different statement
   * ("I have no capacity" vs "I'm not here") that routing and the LP's own dashboard both misread.
   */
  app.post<{ Body: { online?: boolean } }>('/merchants/status', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (typeof req.body?.online !== 'boolean') return reply.code(400).send({ error: 'missing_fields' });
    const r = await ops.setOnline(merchant, req.body.online);
    // All three refusals are 409 here — see refuse()'s note.
    if (!r.ok) return refuse(reply, r, 409);
    return r;
  });

  /**
   * Set the LP's own spread, in basis points off the mid rate — bounded by their tier's cap
   * (the platform's price envelope; merchantStats.TIER_MAX_SPREAD_BPS).
   *
   * This had no writer at all outside the seed: every real LP was pinned to the column default of
   * 50 bps forever, unable to compete on the one axis that is genuinely theirs — the spread IS
   * their entire revenue.
   */
  app.post<{ Body: { spreadBps?: number } }>('/merchants/spread', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const r = await ops.setSpread(merchant, req.body?.spreadBps);
    if (!r.ok) return refuse(reply, r);
    return r;
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

    let built: { unsignedTx: string; feePayer: string; sponsored: boolean };
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
    return { unsignedTx: built.unsignedTx, feePayer: built.feePayer, sponsored: built.sponsored, transferId } satisfies PrepareTransferResponse;
  });

  /**
   * Stake by paying the treasury directly (docs/20). The partner pays `address` from wherever their
   * USDC is and pastes the signature; the chain is read HERE, at submit — what it moved, from whom,
   * under what memo — and stored as the claim. Nothing moves: a human attributes it in the admin
   * console, and only then does a pending `transfers` row exist for the confirmer to verify and
   * creditStakeOnConfirm to credit. The amount is never typed, so a typo can never burn a real deposit.
   */
  app.get('/merchants/stake/claims', async (req): Promise<MerchantStakeClaimsResponse> => {
    const merchant = await requireMerchant(req);
    const claims = await listStakeClaimsForMerchant(merchant.id);
    return { address: config.stakeTreasuryAddress || null, claims: claims.map(toStakeClaim) };
  });

  app.post<{ Body: StakeClaimRequest }>('/merchants/stake/claims', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (!config.stakeTreasuryAddress) return reply.code(503).send({ error: 'staking_unavailable' });
    if (merchant.suspend_reason === 'exited') return reply.code(409).send({ error: 'already_exited' });
    const signature = req.body?.signature?.trim();
    if (!signature || !SIGNATURE_RE.test(signature)) return reply.code(400).send({ error: 'invalid_signature' });
    let read: Awaited<ReturnType<typeof readStakeDeposit>>;
    try {
      read = await readStakeDeposit(signature, config.stakeTreasuryAddress);
    } catch (e) {
      req.log.error({ err: e }, 'stake claim: chain read failed');
      return reply.code(503).send({ error: 'solana_unavailable' });
    }
    // Refused claims are not stored — there is nothing for a reviewer to decide about a signature that
    // never landed, failed, or paid someone else. 'shared' is the one honest dead end: two deposits
    // into the treasury in one tx (two partners in the same exchange batch) — one signature is one
    // transfers row, so a human sorts it by hand.
    if (read.kind === 'not_found') return reply.code(409).send({ error: 'transaction_not_found' });
    if (read.kind === 'failed') return reply.code(400).send({ error: 'transaction_failed' });
    if (read.kind === 'none') return reply.code(400).send({ error: 'not_a_stake_payment' });
    if (read.kind === 'shared') return reply.code(400).send({ error: 'shared_transaction' });
    const r = await insertStakeClaim({
      merchantId: merchant.id,
      signature,
      chain: { amountUsdc: read.amountUsdc, sender: read.sender, memo: read.memo, blockTime: read.blockTime, slot: read.slot },
    });
    // A duplicate IS stored (the reviewer sees both claims) — but the answer to this partner is the
    // same as for their own re-submission: already submitted, a human will sort it out.
    if (r.kind !== 'submitted') return reply.code(409).send({ error: 'signature_already_used' });
    return reply.code(201).send({ id: r.id, status: 'submitted' });
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
  app.post<{ Body: { amountUsd?: string | number; payoutAddress?: string } }>('/merchants/stake/withdraw', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const amountUsd = positiveAmount(req.body?.amountUsd);
    if (amountUsd === null) return reply.code(400).send({ error: 'invalid_amount' });
    // Where it goes is the partner's to say (docs/20): any wallet they hold, their fpay wallet when blank.
    const payoutAddress = parsePayoutAddress(req.body?.payoutAddress);
    if (payoutAddress === undefined) return reply.code(400).send({ error: 'invalid_payout_address' });

    const id = await requestStakeWithdrawal(merchant.id, amountUsd, DISPUTE_CLAW_WINDOW_H, false, payoutAddress);
    if (!id) {
      // One refusal for four causes would be useless to the person reading it, so re-read and say
      // which. Racy by nature — this is an error message, not a gate; the gate is the statement above.
      const open = (await listStakeWithdrawals(merchant.id)).find((w) => w.status === 'requested');
      if (open) return reply.code(409).send({ error: 'withdrawal_already_pending' });
      if (Number(merchant.bond_usdc) < amountUsd) return reply.code(409).send({ error: 'insufficient_bond' });
      if (await hasRecentCompletion(merchant.id, DISPUTE_CLAW_WINDOW_H)) return reply.code(409).send({ error: 'recent_payout' });
      return reply.code(409).send({ error: 'orders_in_flight' });
    }
    return reply.code(201).send({ id, amountUsdc: formatAmount(amt(amountUsd), USDC_DECIMALS) });
  });

  /** Changed their mind before a human released it — the bond goes straight back. Not for an exit:
   *  leaving is final (the row is frozen by trigger the moment it flips). */
  app.post<{ Params: { id: string } }>('/merchants/stake/withdraw/:id/cancel', async (req, reply) => {
    const merchant = await requireMerchant(req);
    if (!(await cancelStakeWithdrawal(merchant.id, req.params.id))) {
      return reply.code(409).send({ error: 'withdrawal_not_cancellable' });
    }
    return { ok: true };
  });

  /** Change where an OPEN request goes. An exit cannot be cancelled, so without this a typo in its
   *  address is a support ticket; with it, one more prompt. Same test as at request time. */
  app.post<{ Params: { id: string }; Body: { payoutAddress?: string } }>('/merchants/stake/withdraw/:id/address', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const payoutAddress = parsePayoutAddress(req.body?.payoutAddress);
    if (payoutAddress === undefined) return reply.code(400).send({ error: 'invalid_payout_address' });
    if (!(await setStakeWithdrawalAddress(merchant.id, req.params.id, payoutAddress))) {
      return reply.code(409).send({ error: 'withdrawal_not_open' });
    }
    return { ok: true };
  });

  /**
   * Leave fpay as a partner. One statement (queries.ts exitMerchant): the whole bond becomes a
   * withdrawal request flagged `exit`, and the row is marked — never deleted — and frozen. Same
   * preconditions as a withdrawal, and the same 409s say which one refused.
   */
  app.post<{ Body: { payoutAddress?: string } }>('/merchants/exit', async (req, reply) => {
    const merchant = await requireMerchant(req);
    const payoutAddress = parsePayoutAddress(req.body?.payoutAddress);
    if (payoutAddress === undefined) return reply.code(400).send({ error: 'invalid_payout_address' });
    const done = await exitMerchant(merchant.id, DISPUTE_CLAW_WINDOW_H, payoutAddress);
    if (!done) {
      if (merchant.suspend_reason === 'exited') return reply.code(409).send({ error: 'already_exited' });
      const open = (await listStakeWithdrawals(merchant.id)).find((w) => w.status === 'requested');
      if (open) return reply.code(409).send({ error: 'withdrawal_already_pending' });
      if (await hasRecentCompletion(merchant.id, DISPUTE_CLAW_WINDOW_H)) return reply.code(409).send({ error: 'recent_payout' });
      return reply.code(409).send({ error: 'orders_in_flight' });
    }
    return reply.code(201).send({ ok: true, withdrawalId: done.withdrawalId });
  });
}
