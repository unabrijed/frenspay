// webhooks.ts — inbound vendor callbacks. All are thin + verified: Helius (tx confirmations;
// the confirmer poller is the fallback), the KYC vendor (session-changed ping; the reconciler
// poller is the fallback), and Xendit payouts (status ping; the order worker's provider poll is
// the fallback).
import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { config } from '../envConfig';
import { appendOrderEvent, claimOrderPayout, getOrderByReference, getTransferBySignature, insertRiskEvent, setTransferStatusBySignature } from '../db/queries';
import { getKycProvider } from '../services/kyc';
import { applyKycForSession } from '../services/kyc/poller';
import { attachDepositByMemo, DISPUTE_WINDOW_MS, onTransferConfirmedAndNotify } from '../services/orderMachine';
import { payoutProviderById } from '../services/payout/provider';
import { verifiedStatus } from '../services/transferVerify';

// Constant-time shared-secret compare for vendor callbacks. Length is checked first because
// timingSafeEqual throws on a length mismatch (and a length is not a secret).
function secretEq(got: unknown, expected: string): boolean {
  return (
    expected.length > 0 &&
    typeof got === 'string' &&
    got.length === expected.length &&
    timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  );
}

export async function registerWebhookRoutes(app: FastifyInstance) {
  // --- M2: Helius webhook for push confirmation (poller in confirmer.ts is the fallback) ---
  // The secret arrives in the Authorization header (Helius' `authHeader` field), never in the URL:
  // query strings are logged in plaintext by every proxy, access log and error tracker on the path.
  app.post('/webhooks/helius', async (req, reply) => {
    if (!config.heliusWebhookSecret) {
      // Fail closed off-local. An open confirmation webhook on a mainnet tier is a forged-signature
      // endpoint; stage is `isDevelopment`, so `isLocal` is the only tier that may run without the
      // secret — and Helius cannot reach a laptop anyway (invariant 31).
      if (!config.isLocal) return reply.code(401).send({ error: 'unauthorized' });
      req.log.warn('HELIUS_WEBHOOK_SECRET unset — /webhooks/helius is open (local only)');
    } else if (!secretEq(req.headers.authorization, config.heliusWebhookSecret)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const events = Array.isArray(req.body)
      ? (req.body as Array<{ signature?: string; transactionError?: unknown }>)
      : [];
    for (const ev of events) {
      if (typeof ev?.signature !== 'string') continue;
      let row = await getTransferBySignature(ev.signature);
      // Unknown signature? It may be a deposit whose /fund-submit dropped after the payer signed: the
      // fee-payer co-signs every deposit, so Helius pushes every one here, and the memo names the
      // order. Attribution only — the row gains its signature and the chain check below decides.
      if (!row && ev.transactionError == null) {
        try {
          if (await attachDepositByMemo(ev.signature)) row = await getTransferBySignature(ev.signature);
        } catch (err) {
          req.log.warn({ err, signature: ev.signature }, 'deposit recovery failed — the poller retries');
        }
      }
      if (!row || row.status !== 'pending') continue; // not ours, or already final
      // Helius sets transactionError (non-null) on failed txs; null/absent means it landed — and
      // "landed" is only half the question. The same chain check the poller runs decides whether the
      // row may flip (transferVerify.ts); a hint is a hint, the chain is the authority.
      const status = ev.transactionError == null ? await verifiedStatus(row) : 'failed';
      if (status === 'pending') continue; // the RPC could not answer right now — the poller retries
      const id = await setTransferStatusBySignature(ev.signature, status);
      // M6: on a real pending→confirmed transition, drive the same advance-order + notify path the
      // poller uses (previously the webhook only flipped the row, so prod webhook-wins dropped both).
      if (id && status === 'confirmed') await onTransferConfirmedAndNotify(id);
    }
    return { ok: true };
  });

  // Real-vendor KYC webhook: a thin "this session changed, go check" ping. We verify the signature
  // for authenticity, then reconcile from the vendor's authoritative decision (applyKycForSession
  // only acts on sessions we issued), so a forged call can't promote anyone. The reconciler poller
  // is the reliable fallback if this never arrives (e.g. no public URL locally).
  app.post('/webhooks/kyc', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!getKycProvider().verifyWebhook(body, req.headers as Record<string, string | undefined>)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
    // Ack within the vendor's ~5s delivery budget: reconcile from the authoritative decision OUT of
    // band rather than awaiting it (the decision fetch alone can take up to FETCH_TIMEOUT_MS). Safe
    // here — long-running Fastify process (async work isn't frozen post-response), the handler is
    // idempotent, and the 15s reconciler poller is the backstop. Returning 200 also avoids a vendor
    // retry storm during a transient DB/vendor failure.
    if (sessionId) {
      void applyKycForSession(sessionId, (m) => req.log.info(m)).catch((err) =>
        req.log.warn({ err, sessionId }, 'kyc webhook processing failed'),
      );
    }
    return { ok: true };
  });

  // Xendit payout webhook, per provider ACCOUNT (docs/23): /webhooks/xendit/:providerId — the path
  // names the payout_providers row whose callback token must sign the call, because one vendor is
  // many accounts (xendit_id, xendit_th, …) and a token must never claim another account's order.
  // The webhook is a HINT, never the authority (the KYC contract two handlers up): after auth we
  // assert the order is bound to THIS provider, then re-derive the status from the provider's own
  // check() before touching the CAS. A claim that returns false on a refunded/completed order is
  // the one signal that fiat left the building on an order we already settled — it is RECORDED
  // (order_event + risk_events), never dropped: the old handler's silent 200 also stopped the
  // vendor retry that would have surfaced the conflict.
  app.post<{ Params: { providerId: string } }>('/webhooks/xendit/:providerId', async (req, reply) => {
    const { providerId } = req.params;
    const expected = config.payoutCallbackTokens[providerId];
    if (typeof expected !== 'string' || !secretEq(req.headers['x-callback-token'], expected)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const data = ((req.body ?? {}) as { data?: Record<string, unknown> }).data ?? (req.body as Record<string, unknown>);
    const reference = typeof data?.reference_id === 'string' ? data.reference_id : null;
    const status = typeof data?.status === 'string' ? data.status : null;
    if (!reference || !status) return { ok: true };

    const order = await getOrderByReference(reference);
    // Account identity: a valid token for account A must not act on an order bound to account B
    // (references are order-scoped, identical across accounts).
    if (!order || !order.merchant_id || order.payout_provider_id !== providerId) return { ok: true };

    const orphan = async (why: string) => {
      await appendOrderEvent(order.id, order.state, order.state, 'payout_orphaned', {
        provider: providerId,
        providerRef: order.payout_provider_ref,
        reference,
        raw: status,
        why,
      });
      await insertRiskEvent({
        userId: order.user_id,
        kind: 'payout_orphaned_webhook',
        amountUsd: Number(order.amount_usdc),
        decision: 'review',
        score: 0,
        reason: `${why}: ${providerId} reports ${status} for ${reference} while order is ${order.state}`,
        counterparty: `${providerId}:${reference}`,
      });
    };

    if (status === 'SUCCEEDED') {
      // Re-derive before claiming — the webhook body is unauthenticated data wearing a valid
      // envelope; the provider's API is the authority.
      const provider = await payoutProviderById(providerId, (m) => req.log.warn(m));
      const chk = await provider?.check(reference).catch(() => null);
      if (chk?.status === 'paid') {
        const claimed = await claimOrderPayout({
          orderId: order.id,
          merchantId: order.merchant_id,
          reference: `${providerId}:${reference}`,
          windowMs: DISPUTE_WINDOW_MS,
        });
        if (!claimed && (order.state === 'refunded' || order.state === 'completed' || order.state === 'funds_released')) {
          await orphan('paid_after_settlement');
        }
      }
    } else if (status === 'REVERSED' && (order.state === 'funds_released' || order.state === 'completed')) {
      // Post-RELEASE reversal: escrow is already gone, the fiat unwound at the vendor. Nothing to
      // freeze — record the incident loudly. (Pre-release reversals are caught by the worker's
      // release gate; this is the only observer once the order settles.)
      await orphan('reversed_after_release');
    }
    return { ok: true };
  });
}
