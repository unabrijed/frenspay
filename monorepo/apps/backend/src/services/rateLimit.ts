// rateLimit.ts — M6 in-house rate limiter (no deps, single-instance). Fixed-window counters in a Map
// keyed by bucket:identity, applied as a global onRequest hook to the sensitive routes — protects
// money-movement + the faucet (fee-payer drain vector) + auth from abuse. Multi-instance production
// swaps this for @fastify/rate-limit + Redis at M7.
import type { FastifyReply, FastifyRequest } from 'fastify';

import { metrics } from './metrics';

interface Rule {
  method: string;
  path: string;
  bucket: string;
  limit: number;
  windowMs: number;
}

// Per-minute caps. Faucet is tightest (it mints + spends fee-payer SOL); reads are unlimited.
export const RATE_LIMIT_RULES: Rule[] = [
  { method: 'POST', path: '/transfer/prepare', bucket: 'send', limit: 20, windowMs: 60_000 },
  { method: 'POST', path: '/orders', bucket: 'order', limit: 20, windowMs: 60_000 },
  { method: 'POST', path: '/orders/quote', bucket: 'quote', limit: 30, windowMs: 60_000 },
  { method: 'POST', path: '/devnet/faucet', bucket: 'faucet', limit: 5, windowMs: 60_000 },
  { method: 'POST', path: '/auth/sync', bucket: 'auth', limit: 10, windowMs: 60_000 },
];

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

function identity(req: FastifyRequest): string {
  return (
    (req.headers['x-dev-user-id'] as string) ||
    (req.headers['authorization'] as string) ||
    req.ip ||
    'anon'
  );
}

/** Build the Fastify onRequest hook. Returns 429 (with retry-after) past a route's per-window cap. */
export function rateLimitHook(rules: Rule[] = RATE_LIMIT_RULES) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0];
    const rule = rules.find((r) => r.method === req.method && r.path === path);
    if (!rule) return;

    const key = `${rule.bucket}:${identity(req)}`;
    const now = Date.now();
    const w = windows.get(key);
    if (!w || now >= w.resetAt) {
      windows.set(key, { count: 1, resetAt: now + rule.windowMs });
      return;
    }
    if (w.count >= rule.limit) {
      metrics.inc('rate_limited');
      const retryAfterSecs = Math.ceil((w.resetAt - now) / 1000);
      return reply.code(429).header('retry-after', retryAfterSecs).send({ error: 'rate_limited', retryAfterSecs });
    }
    w.count += 1;
  };
}

/** Drop expired windows so the Map can't grow unbounded (call periodically). */
export function sweepRateLimitWindows(): void {
  const now = Date.now();
  for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
}

/** Test seam: reset all windows (used by the check-infra harness). */
export function resetRateLimitWindows(): void {
  windows.clear();
}
