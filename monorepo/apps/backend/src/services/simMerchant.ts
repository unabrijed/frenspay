// simMerchant.ts — the merchant/LP worker + escalation timers (M1 simulated rails, M2-hardened).
// Runs each confirmer tick over orders in payment_detected / merchant_confirms.
//
// THREE KINDS OF MERCHANT, told apart by `sim_behavior`:
//   sim_behavior NOT NULL → a seeded SIMULATED LP; this worker plays its part per the behaviour:
//     happy      → confirm payout, release escrow
//     slow       → delayed, then recovers and releases
//     no_receipt → under_review, then refund on grace
//     timeout    → no response → delayed → under_review → refund
//     psp        → a PLATFORM SETTLEMENT ROW (docs/23): the payout-provider registry
//                  (services/payout) executes the fiat leg via API — sticky per-order binding,
//                  priority failover on terminal failure, raw-status discipline (REVERSED freezes,
//                  never fails over; refunds require that nothing was ever initiated). On success
//                  the worker claims through the SAME claimOrderPayout CAS a human uses, and a
//                  final check() gates the release against post-claim reversals.
//   sim_behavior NULL     → a REAL (human) merchant. The worker never pays on their behalf; it only
//     releases escrow once they've marked the order paid AND the dispute window closed clean, or
//     escalates when they go silent. Applying a sim behaviour here would release a real merchant's
//     escrow seconds after funding, before they ever saw the order.
//
// Escalation gates on the order's expires_at (an absolute deadline, immune to unrelated updated_at
// bumps); short LP-action delays use time-in-state. Also recovers orders stuck mid-release and
// retires orders abandoned before funding.
import {
  advanceOrderPayoutProvider,
  appendOrderEvent,
  bindOrderPayoutProvider,
  casOrderState,
  claimOrderPayout,
  expireStaleOrders,
  hasOpenDispute,
  insertRiskEvent,
  listWorkerOrders,
  setOrderPayoutProviderRef,
  updateOrder,
  withUserLock,
  type WorkerOrderRow,
} from '../db/queries';

import { DISPUTE_WINDOW_MS, flagResolution, refundToUser, releaseToMerchant, rerouteOrder } from './orderMachine';
import { payoutProviderById, payoutProviderFor } from './payout/provider';

/**
 * Freeze an order for a human (invariant 12): resolution 'under_review' with expires_at NULL, so
 * no SLA ever fires again — the ladder can neither refund nor release it — plus an order_event and
 * a risk_events 'review' row (the admin dashboard surfaces those; an order_event alone is invisible
 * until someone opens an order they believe is closed). Idempotent: a second call on an
 * already-frozen order is a no-op, so the worker can keep polling a terminal-reversed payout
 * without flooding the timeline.
 */
async function freezeOrder(o: WorkerOrderRow, event: string, kind: string, detail: Record<string, unknown>): Promise<void> {
  if (o.resolution === 'under_review' && o.expires_at == null) return; // already frozen
  await updateOrder(o.id, { resolution: 'under_review', expiresAt: null });
  await appendOrderEvent(o.id, o.state, o.state, event, detail);
  await insertRiskEvent({
    userId: o.user_id,
    kind,
    amountUsd: Number(o.amount_usdc),
    decision: 'review',
    score: 0,
    reason: `${event}: ${JSON.stringify(detail)}`.slice(0, 500),
    counterparty: `${o.payout_provider_id ?? 'unbound'}:${o.reference_code}`,
  });
}

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

      // Provider-driven fiat leg (platform settlement row, docs/23). Unclaimed only — once claimed
      // it joins the release path below. NO resolution gate: polling continues while escalated
      // (invariant 12) — the old gate stopped the only check() call site at the first escalation
      // and let the ladder refund an order whose payout later settled.
      if (o.sim_behavior === 'psp' && o.state === 'payment_detected' && !o.payout_claimed_at) {
        // Sticky first (invariant 13): an order polls the account that may hold its money even if
        // the row was disabled — enable/priority affect SELECTION only. Binding happens BEFORE the
        // first initiate: vendor idempotency does not span accounts, so this write order is what
        // makes a crash or admin flip unable to double-disburse.
        let provider = o.payout_provider_id ? await payoutProviderById(o.payout_provider_id, log) : null;
        if (!provider && !o.payout_provider_id && o.payout_method && o.payout_destination) {
          const candidate = await payoutProviderFor(o.payout_method, o.payout_providers_tried, log);
          if (candidate) {
            const bound = await bindOrderPayoutProvider(o.id, candidate.id);
            if (bound === candidate.id) {
              await appendOrderEvent(o.id, o.state, o.state, 'payout_initiated', {
                provider: bound,
                attempt: o.payout_providers_tried.length + 1,
                reference: o.reference_code,
              });
              provider = candidate;
            } else if (bound) {
              provider = await payoutProviderById(bound, log); // a racing tick bound first — follow it
            }
          }
        }

        if (provider && o.payout_destination) {
          // initiate is idempotent by reference (order reference_code = provider reference_id),
          // so calling it every tick until the status lands is the retry loop.
          await provider.initiate({
            reference: o.reference_code,
            amountFiat: o.amount_inr,
            currency: o.currency,
            destination: o.payout_destination,
            name: o.payout_name ?? undefined,
          });
          const chk = await provider.check(o.reference_code);
          if (chk.providerRef && !o.payout_provider_ref) await setOrderPayoutProviderRef(o.id, chk.providerRef);

          if (chk.status === 'paid') {
            await claimOrderPayout({
              orderId: o.id,
              merchantId: o.merchant_id!,
              reference: `${provider.id}:${o.reference_code}`,
              windowMs: DISPUTE_WINDOW_MS,
            });
            log?.(`order ${o.id} fiat leg disbursed via ${provider.id}`);
          } else if (chk.status === 'reversed') {
            // Money moved and came back (invariant 12): NEVER fail over (a second disbursement
            // could double-pay), never refund from here — freeze for a human.
            await freezeOrder(o, 'payout_orphaned', 'payout_reversed', {
              provider: provider.id,
              providerRef: chk.providerRef ?? o.payout_provider_ref,
              raw: chk.raw,
              reference: o.reference_code,
              amountFiat: o.amount_inr,
              currency: o.currency,
            });
            log?.(`order ${o.id} FROZEN (${provider.id} payout ${chk.raw})`);
          } else if (chk.status === 'failed') {
            // Terminal, money never moved — failover is safe. Next enabled provider by priority,
            // excluding everything tried; the advance is a CAS on the old binding.
            const next = o.payout_method ? await payoutProviderFor(o.payout_method, o.payout_providers_tried, log) : null;
            if (next && (await advanceOrderPayoutProvider(o.id, provider.id, next.id))) {
              await appendOrderEvent(o.id, o.state, o.state, 'payout_failed_over', {
                from: provider.id,
                to: next.id,
                attempt: o.payout_providers_tried.length + 1,
                raw: chk.raw,
              });
              log?.(`order ${o.id} → next provider ${next.id} (${provider.id} ${chk.raw})`);
            } else if (o.resolution !== 'under_review') {
              await appendOrderEvent(o.id, o.state, o.state, 'payout_exhausted', { attempted: o.payout_providers_tried });
              await flagResolution(o.id, 'payment_detected', 'under_review', 'psp_payout_failed');
              log?.(`order ${o.id} → under_review (providers exhausted, all terminal-failed)`);
            }
          } else if (slaReached) {
            // Still pending. Escalate INSIDE this branch (the generic ladder no longer sees
            // unclaimed psp orders) — but the end of THIS ladder is a freeze, never a refund:
            // a non-terminal payout may still settle (the C2 double-pay).
            if (o.resolution == null) {
              await flagResolution(o.id, 'payment_detected', 'delayed', 'psp_payout_slow');
              log?.(`order ${o.id} → delayed (${provider.id} payout still pending)`);
            } else if (o.resolution === 'delayed') {
              await flagResolution(o.id, 'payment_detected', 'under_review', 'escalated');
              log?.(`order ${o.id} → under_review (${provider.id} payout still pending)`);
            } else {
              await freezeOrder(o, 'payout_frozen', 'payout_unresolved', {
                provider: provider.id,
                providerRef: chk.providerRef ?? o.payout_provider_ref,
                raw: chk.raw,
                reference: o.reference_code,
              });
              log?.(`order ${o.id} FROZEN (${provider.id} payout non-terminal past every SLA)`);
            }
          }
          continue;
        }

        if (o.payout_provider_id) {
          // Bound but unresolvable (row gone / credential unset mid-flight): money may be in
          // flight at an account we can no longer ask — refund would be a blind double-pay.
          await freezeOrder(o, 'payout_frozen', 'payout_provider_lost', {
            provider: o.payout_provider_id,
            reference: o.reference_code,
          });
          log?.(`order ${o.id} FROZEN (bound provider ${o.payout_provider_id} unresolvable)`);
          continue;
        }
        // Never bound → nothing was ever initiated, so the silence ladder below (delayed →
        // under_review → reroute → refund) is provably safe. Fall through.
      }

      // REAL (human) merchant — sim_behavior NULL — or a PSP LP whose disbursement already claimed:
      // the sim behaviours must never touch these. A real merchant row inheriting 'happy' would get
      // its escrow auto-released ~4s after payment_detected before the person ever saw the order.
      if ((o.sim_behavior == null || o.sim_behavior === 'psp') && o.state === 'payment_detected') {
        if (o.payout_claimed_at) {
          // They reported paying — release when the dispute window closes clean. The dispute is
          // re-read INSIDE the per-user lock so a dispute landing mid-tick can't lose the race.
          if (slaReached && !o.dispute_open) {
            if (o.sim_behavior === 'psp') {
              // Post-claim reversal gate (invariant 12): a vendor can flip SUCCEEDED → REVERSED
              // after the claim, and nothing else ever re-reads the status once payout_claimed_at
              // is set. One final check() decides the release; anything but a verified 'paid'
              // (including an unresolvable provider) freezes instead of releasing.
              const provider = o.payout_provider_id ? await payoutProviderById(o.payout_provider_id, log) : null;
              const chk = provider ? await provider.check(o.reference_code) : null;
              if (chk?.status !== 'paid') {
                await freezeOrder(o, 'payout_orphaned', 'payout_unverified_at_release', {
                  provider: o.payout_provider_id,
                  providerRef: chk?.providerRef ?? o.payout_provider_ref,
                  raw: chk?.raw ?? 'provider_unresolvable',
                  reference: o.reference_code,
                  amountFiat: o.amount_inr,
                  currency: o.currency,
                });
                log?.(`order ${o.id} FROZEN at release gate (${o.payout_provider_id}: ${chk?.raw ?? 'unresolvable'})`);
                continue;
              }
            }
            await withUserLock(o.user_id, async () => {
              if (!(await hasOpenDispute(o.id))) await release();
            });
            log?.(`order ${o.id} → funds_released (fiat leg verified/claimed, dispute window closed)`);
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
