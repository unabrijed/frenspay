// webhooks.ts — inbound vendor callbacks. All are thin + verified: Helius (tx confirmations;
// the confirmer poller is the fallback), the KYC vendor (session-changed ping; the reconciler
// poller is the fallback), and Xendit payouts (status ping; the order worker's provider poll is
// the fallback).
import type { FastifyInstance } from 'fastify';

import { config } from '../envConfig';
import { claimOrderPayout, getOrderByReference, setTransferStatusBySignature } from '../db/queries';
import { getKycProvider } from '../services/kyc';
import { applyKycForSession } from '../services/kyc/poller';
import { DISPUTE_WINDOW_MS, onTransferConfirmedAndNotify } from '../services/orderMachine';

export async function registerWebhookRoutes(app: FastifyInstance) {
  // --- M2: Helius webhook for push confirmation (poller in confirmer.ts is the fallback) ---
  app.post<{ Querystring: { secret?: string } }>('/webhooks/helius', async (req, reply) => {
    if (config.heliusWebhookSecret) {
      if (req.query.secret !== config.heliusWebhookSecret) return reply.code(401).send({ error: 'unauthorized' });
    } else {
      req.log.warn('HELIUS_WEBHOOK_SECRET unset — /webhooks/helius is open (dev only)');
    }
    const events = Array.isArray(req.body)
      ? (req.body as Array<{ signature?: string; transactionError?: unknown }>)
      : [];
    for (const ev of events) {
      if (typeof ev?.signature === 'string') {
        // Helius sets transactionError (non-null) on failed txs; null/absent means success.
        const status = ev.transactionError == null ? 'confirmed' : 'failed';
        const id = await setTransferStatusBySignature(ev.signature, status);
        // M6: on a real pending→confirmed transition, drive the same advance-order + notify path the
        // poller uses (previously the webhook only flipped the row, so prod webhook-wins dropped both).
        if (id && status === 'confirmed') await onTransferConfirmedAndNotify(id);
      }
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

  // Xendit payout webhook: a fast "this disbursement succeeded" hint — the order worker's provider
  // poll is the authoritative fallback (same contract as Helius/KYC above). Verified by the shared
  // callback token; a forged/duplicate call is harmless anyway: claimOrderPayout is a CAS, and we
  // only ever act on SUCCEEDED for a reference we minted.
  app.post('/webhooks/xendit', async (req, reply) => {
    if (!config.xenditCallbackToken || req.headers['x-callback-token'] !== config.xenditCallbackToken) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const data = ((req.body ?? {}) as { data?: Record<string, unknown> }).data ?? (req.body as Record<string, unknown>);
    const reference = typeof data?.reference_id === 'string' ? data.reference_id : null;
    const status = typeof data?.status === 'string' ? data.status : null;
    if (reference && status === 'SUCCEEDED') {
      const order = await getOrderByReference(reference);
      if (order?.merchant_id) {
        await claimOrderPayout({
          orderId: order.id,
          merchantId: order.merchant_id,
          reference: `xendit:${reference}`,
          windowMs: DISPUTE_WINDOW_MS,
        });
      }
    }
    return { ok: true };
  });
}
