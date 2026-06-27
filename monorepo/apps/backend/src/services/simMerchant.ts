// simMerchant.ts — the simulated merchant/LP + escalation timers (M1 simulated rails, M2-hardened).
// Runs each confirmer tick. Drives orders in payment_detected / merchant_confirms per the assigned
// merchant's sim_behavior, exercising the failure-first resolution states from the doc:
//   happy      → confirm payout, release escrow
//   slow       → delayed, then recovers and releases
//   no_receipt → under_review, then refund on grace
//   timeout    → no response → delayed → under_review → refund
// Escalation gates on the order's expires_at (an absolute deadline, immune to unrelated updated_at
// bumps); short LP-action delays use time-in-state. Also recovers orders stuck mid-release and
// retires orders abandoned before funding.
import { casOrderState, expireStaleOrders, listWorkerOrders } from '../db/queries';

import { flagResolution, refundToUser, releaseToMerchant, rerouteOrder } from './orderMachine';

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
    const behavior = o.sim_behavior ?? 'happy';
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
          if (await casOrderState(o.id, ['merchant_confirms'], 'funds_released'))
            log?.(`order ${o.id} recovered: merchant_confirms → funds_released`);
        } else if (elapsed >= STUCK_RELEASE_MS) {
          if (await casOrderState(o.id, ['merchant_confirms'], 'payment_detected'))
            log?.(`order ${o.id} recovered: merchant_confirms → payment_detected (retry)`);
        }
        continue;
      }

      // Clean payment_detected: the LP picks the order up (or stalls, per behavior).
      if (o.state === 'payment_detected' && o.resolution == null) {
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

      // Delayed: slow LPs recover and release; everyone else escalates to review at the SLA.
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
