// Isolated callback sink for sandbox verification. No orders/ledger/escrow imports or mutations.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export function validStraitsxSignature(raw: Buffer, signature: unknown, secret: string): boolean {
  if (!secret.trim() || /[<>]|your[-_ ]/i.test(secret) || typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export async function registerStraitsxSandboxWebhook(app: FastifyInstance, signingSecret: string): Promise<void> {
  await app.register(async (sandbox) => {
    // Parser override is encapsulated here: existing webhook JSON parsers remain unchanged.
    sandbox.removeContentTypeParser('application/json');
    sandbox.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    sandbox.post('/webhooks/straitsx/straitsx_sg_sandbox', { bodyLimit: 65_536 }, async (req, reply) => {
      const raw = req.body;
      if (!Buffer.isBuffer(raw) || !validStraitsxSignature(raw, req.headers['xfers-signature'], signingSecret)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      let body: unknown;
      try { body = JSON.parse(raw.toString('utf8')); }
      catch { return reply.code(400).send({ error: 'invalid_json' }); }
      // Callback layouts vary by product. Log a bounded contract ID only; never identity fields,
      // raw bodies, secrets or a purported success that could be mistaken for a real receipt.
      const envelope = body as { id?: unknown; data?: { id?: unknown } } | null;
      const id = envelope?.data?.id ?? envelope?.id;
      const contractId = typeof id === 'string' && /^[a-zA-Z0-9_-]{1,191}$/.test(id) ? id : undefined;
      req.log.info({ provider: 'straitsx_sg_sandbox', sandboxOnly: true, contractId }, 'sandbox callback received; no payment state changed');
      return { ok: true, sandboxOnly: true };
    });
  });
}
