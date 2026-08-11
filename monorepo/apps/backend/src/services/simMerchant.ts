// simMerchant.ts — the merchant/LP worker + escalation timers (M1 simulated rails, M2-hardened).
// Runs each confirmer tick over orders in payment_detected / merchant_confirms.
//
// THREE KINDS OF MERCHANT, told apart by `sim_behavior`:
//   sim_behavior NOT NULL → a seeded SIMULATED LP; this worker plays its part per the behaviour:
//     happy      → confirm payout, release escrow
//     slow       → delayed, then recovers and releases
//     no_receipt → under_review, then refund on grace
//     timeout    → no response → delayed → under_review → refund
//     psp        → the payout provider (services/payout) executes the fiat leg via API; on success
//                  the worker claims through the SAME claimOrderPayout CAS a human uses, and the
//                  real-merchant release path below finishes the order. No provider configured →
//                  never claims → the shared escalation ladder makes the user whole.
//   sim_behavior NULL     → a REAL (human) merchant. The worker never pays on their behalf; it only
//     releases escrow once they've marked the order paid AND the dispute window closed clean, or
//     escalates when they go silent. Applying a sim behaviour here would release a real merchant's
//     escrow seconds after funding, before they ever saw the order.
//
// Escalation gates on the order's expires_at (an absolute deadline, immune to unrelated updated_at
// bumps); short LP-action delays use time-in-state. Also recovers orders stuck mid-release and
// retires orders abandoned before funding.
import {
  appendOrderEvent,
  casOrderState,
  claimOrderPayout,
  expireStaleOrders,
  hasOpenDispute,
  listWorkerOrders,
  withUserLock,
} from '../db/queries';

import { DISPUTE_WINDOW_MS, flagResolution, refundToUser, releaseToMerchant, rerouteOrder } from './orderMachine';
import { payoutProviderFor } from './payout/provider';

const SIM_DELAY_MS = 4_000; // a healthy LP confirms ~one tick after the funds are detected (demo-tuned)
const STUCK_RELEASE_MS = 20_000; // merchant_confirms with no release tx this long → recover + retry

export async function runOrderWorkerOnce(log?: (m: string) => void): Promise<void> {
  // Retire orders prepared but never funded (client signing abandoned) so they don't linger.
  const stale = await expireStaleOrders();
  if (stale > 0) log?.(`expired ${stale} stale unfunded order(s)`);

  const orders = await listWorkerOrders();
  const now = Date.now();
  for (const o of orders) {
    const elapsed = now - o.updated_at.getTime();
    const slaReached = o.expires_at ? now >= o.expires_at.getTime() : false;
    const amountUsdc = Number(o.amount_usdc);
    const behavior = o.sim_behavior; // null = a real (human) merchant, not a simulated one
    const release = () =>
      o.treasury_address
        ? releaseToMerchant({ orderId: o.id, reference: o.reference_code, amountUsdc, treasuryAddress: o.treasury_address })
        : Promise.resolve();
    try {
      // Recovery: releaseToMerchant transitions away from merchant_confirms only after a successful
      // broadcast. A lingering merchant_confirms means the release broadcast failed (no tx → reset to
      // retry) or the final transition didn't land (tx recorded → finish advancing).
      if (o.state === 'merchant_confirms') {
        if (o.escrow_release_transfer_id) {
          if (await casOrderState(o.id, ['merchant_confirms'], 'funds_released')) {
            await appendOrderEvent(o.id, 'merchant_confirms', 'funds_released', 'release_recovered');
            log?.(`order ${o.id} recovered: merchant_confirms → funds_released`);
          }
        } else if (elapsed >= STUCK_RELEASE_MS) {
          if (await casOrderState(o.id, ['merchant_confirms'], 'payment_detected')) {
            await appendOrderEvent(o.id, 'merchant_confirms', 'payment_detected', 'release_retry');
            log?.(`order ${o.id} recovered: merchant_confirms → payment_detected (retry)`);
          }
        }
        continue;
      }

      // PSP-driven LP: drive the fiat leg through the payout provider. Unclaimed + unescalated
      // only — once claimed it joins the real-merchant release path below; once escalating, the
      // shared ladder owns it (reroute → refund keeps the payer whole even if the PSP never pays).
      if (o.sim_behavior === 'psp' && o.state === 'payment_detected' && !o.payout_claimed_at && o.resolution == null) {
        const provider = o.payout_method ? payoutProviderFor(o.payout_method) : null;
        if (provider && o.payout_destination && o.merchant_id) {
          // initiate is idempotent by reference (order reference_code = provider reference_id),
          // so calling it every tick until the status lands is the retry loop.
          await provider.initiate({
            reference: o.reference_code,
            amountFiat: o.amount_inr,
            currency: o.currency,
            destination: o.payout_destination,
            name: o.payout_name ?? undefined,
          });
          const status = await provider.check(o.reference_code);
          if (status === 'paid') {
            await claimOrderPayout({
              orderId: o.id,
              merchantId: o.merchant_id,
              reference: `${provider.id}:${o.reference_code}`,
              windowMs: DISPUTE_WINDOW_MS,
            });
            log?.(`order ${o.id} fiat leg disbursed via ${provider.id}`);
          } else if (status === 'failed') {
            await flagResolution(o.id, 'payment_detected', 'under_review', 'psp_payout_failed');
            log?.(`order ${o.id} → under_review (${provider.id} payout failed)`);
          } else if (slaReached) {
            await flagResolution(o.id, 'payment_detected', 'delayed', 'psp_payout_slow');
            log?.(`order ${o.id} → delayed (${provider.id} payout still pending)`);
          }
        } else if (slaReached) {
          // No provider configured (or a destination-less order) — same silence ladder as a
          // no-show human LP.
          await flagResolution(o.id, 'payment_detected', 'delayed', 'no_response');
          log?.(`order ${o.id} → delayed (psp LP has no provider configured)`);
        }
        continue;
      }

      // REAL (human) merchant — sim_behavior NULL — or a PSP LP whose disbursement already claimed:
      // the sim behaviours must never touch these. A real merchant row inheriting 'happy' would get
      // its escrow auto-released ~4s after payment_detected before the person ever saw the order.
      if ((o.sim_behavior == null || o.sim_behavior === 'psp') && o.state === 'payment_detected') {
        if (o.payout_claimed_at) {
          // They reported paying — release when the dispute window closes clean. The dispute is
          // re-read INSIDE the per-user lock so a dispute landing mid-tick can't lose the race.
          if (slaReached && !o.dispute_open) {
            await withUserLock(o.user_id, async () => {
              if (!(await hasOpenDispute(o.id))) await release();
            });
            log?.(`order ${o.id} → funds_released (real LP, dispute window closed)`);
          }
          continue;
        }
        // Never claimed → start the shared escalation ladder so a silent LP still refunds the payer.
        if (o.resolution == null && slaReached) {
          await flagResolution(o.id, 'payment_detected', 'delayed', 'no_response');
          log?.(`order ${o.id} → delayed (real LP hasn't marked it paid)`);
          continue;
        }
        // Already escalating → fall through to the shared delayed/under_review ladder below.
      }

      // Clean payment_detected: the LP picks the order up (or stalls, per behavior).
      if (o.sim_behavior != null && o.state === 'payment_detected' && o.resolution == null) {
        if (behavior === 'happy' && elapsed >= SIM_DELAY_MS) {
          await release();
          log?.(`order ${o.id} → funds_released (happy LP)`);
        } else if (behavior === 'slow' && elapsed >= SIM_DELAY_MS) {
          await flagResolution(o.id, 'payment_detected', 'delayed', 'merchant_slow');
          log?.(`order ${o.id} → delayed (slow LP)`);
        } else if (behavior === 'no_receipt' && elapsed >= SIM_DELAY_MS) {
          await flagResolution(o.id, 'payment_detected', 'under_review', 'merchant_no_receipt');
          log?.(`order ${o.id} → under_review (no receipt)`);
        } else if (behavior === 'timeout' && slaReached) {
          await flagResolution(o.id, 'payment_detected', 'delayed', 'no_response');
          log?.(`order ${o.id} → delayed (LP timed out)`);
        }
        continue;
      }

      // Delayed: slow SIM LPs recover and release; everyone else — including a silent real merchant
      // (behavior null) — escalates to review at the SLA, then reroutes or refunds below.
      if (o.resolution === 'delayed') {
        if (behavior === 'slow' && elapsed >= SIM_DELAY_MS) {
          await release();
          log?.(`order ${o.id} → funds_released (slow LP recovered)`);
        } else if (behavior !== 'slow' && slaReached) {
          await flagResolution(o.id, 'payment_detected', 'under_review', 'escalated');
          log?.(`order ${o.id} → under_review (escalated)`);
        }
        continue;
      }

      // Under review past SLA: M3 silent auto-failover — re-route to the next-best LP first; only make
      // the user whole (refund) once no candidate is left or the attempt cap is reached.
      if (o.resolution === 'under_review' && slaReached) {
        const rerouted = await rerouteOrder({ orderId: o.id, payoutMethod: o.payout_method ?? 'UPI', amountUsdc });
        if (rerouted) {
          log?.(`order ${o.id} → rerouted (failover)`);
        } else {
          await refundToUser({ orderId: o.id, userId: o.user_id, reference: o.reference_code, amountUsdc });
          log?.(`order ${o.id} → refunded (no routes left)`);
        }
      }
    } catch (e) {
      log?.(`order ${o.id} worker error: ${String(e)}`);
    }
  }
}
