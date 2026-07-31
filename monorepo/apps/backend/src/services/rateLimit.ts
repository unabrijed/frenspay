// rateLimit.ts — M6 in-house rate limiter (no deps, single-instance). Fixed-window counters in a Map
// keyed by bucket:identity, applied as a global onRequest hook to the sensitive routes — protects
// money-movement + the faucet (fee-payer drain vector) + auth from abuse. Multi-instance production
// swaps this for @fastify/rate-limit + Redis at M7.
import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config';

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
  // Each verify spends a paid KYC vendor session — cap it so a client can't burn the quota / run up cost.
  { method: 'POST', path: '/kyc/verify', bucket: 'kyc', limit: 5, windowMs: 60_000 },
  // Directory lookups: enough for typing-debounced resolves, useless for alias-space scraping.
  { method: 'GET', path: '/users/resolve', bucket: 'resolve', limit: 30, windowMs: 60_000 },
  // Cross-chain money movement shares the send bucket; deposit reports get their own modest cap.
  { method: 'POST', path: '/crosschain/prepare', bucket: 'send', limit: 20, windowMs: 60_000 },
  { method: 'POST', path: '/crosschain/deposit', bucket: 'send', limit: 20, windowMs: 60_000 },
  // Each enroll round-trips to the Privy API — keep it capped.
  { method: 'POST', path: '/me/phone', bucket: 'auth', limit: 10, windowMs: 60_000 },
  { method: 'POST', path: '/me/country', bucket: 'auth', limit: 10, windowMs: 60_000 },
  // Merchant/LP writes. `apply` inserts a row that the stats recompute pass walks on the same tick
  // as the order worker, so unbounded inserts would starve settlement — cap it hard.
  { method: 'POST', path: '/merchants/apply', bucket: 'auth', limit: 5, windowMs: 60_000 },
  { method: 'POST', path: '/merchants/orders/:id/paid', bucket: 'order', limit: 20, windowMs: 60_000 },
  { method: 'POST', path: '/merchants/stake/prepare', bucket: 'send', limit: 20, windowMs: 60_000 },
  { method: 'POST', path: '/orders/:id/feedback', bucket: 'order', limit: 20, windowMs: 60_000 },
  // Public (unauthenticated) landing-page endpoints — anonymous callers key on IP. The confirm click
  // is capped too: it is the one path that can trigger a DB write from a bare GET.
  { method: 'POST', path: '/waitlist', bucket: 'waitlist', limit: 5, windowMs: 60_000 },
  { method: 'GET', path: '/waitlist/verify', bucket: 'waitlist', limit: 10, windowMs: 60_000 },
];

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

function identity(req: FastifyRequest): string {
  // `x-dev-user-id` is a client-spoofable dev shim — honoring it beyond a local machine lets an
  // authenticated attacker rotate the header to mint a fresh bucket per request and defeat every cap
  // (stage runs with isDevelopment=true, so gate on isLocal). Otherwise key on the bearer token
  // (stable per user) then the peer IP.
  const dev = config.isLocal ? (req.headers['x-dev-user-id'] as string | undefined) : undefined;
  return dev || (req.headers['authorization'] as string) || req.ip || 'anon';
}

/** Build the Fastify onRequest hook. Returns 429 (with retry-after) past a route's per-window cap. */
export function rateLimitHook(rules: Rule[] = RATE_LIMIT_RULES) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Match on the ROUTE pattern (`/orders/:id/feedback`), not the raw URL — raw-URL matching made
    // every param-path rule dead code. 404s (and the check-infra fake req) have no routeOptions.url
    // and fall back to the literal path, which is all they can match anyway.
    const path = req.routeOptions?.url ?? req.url.split('?')[0];
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

let sweepTimer: ReturnType<typeof setInterval> | null = null;
/** Start an independent sweep so the Map can't leak — NOT coupled to the confirmer (which is a no-op
 *  without a configured mint). Idempotent; unref'd so it never holds the process open. */
export function startRateLimitSweeper(intervalMs = 60_000): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweepRateLimitWindows, intervalMs);
  sweepTimer.unref?.();
}

/** Test seam: reset all windows (used by the check-infra harness). */
export function resetRateLimitWindows(): void {
  windows.clear();
}
