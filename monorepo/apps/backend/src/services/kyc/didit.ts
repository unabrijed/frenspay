// Didit identity verification (M7). Hosted document + liveness flow: we create a session, the user
// completes it at the returned URL, and we learn the outcome from the vendor API. We treat the
// `GET decision` endpoint (authenticated with our API key) as the SOURCE OF TRUTH for tier upgrades;
// the webhook is only a fast "go check this session now" ping. That keeps correctness independent of
// the exact webhook signature/canonical-string format, which we still verify best-effort for authenticity.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../../config';

import type { KycDecision, KycProvider, KycStartResult } from './provider';

const REPLAY_WINDOW_S = 300; // reject webhooks older than 5 min (replay defense)

/** Map Didit's status strings to our normalized outcome. */
function mapStatus(s: unknown): KycDecision['status'] {
  switch (String(s ?? '').toLowerCase()) {
    case 'approved':
      return 'approved';
    case 'declined':
      return 'declined';
    case 'in review':
    case 'in_review':
      return 'in_review';
    case 'expired':
    case 'kyc expired':
    case 'abandoned':
      return 'expired'; // terminal-but-unverified — stop reconciling (the user can start over)
    default:
      return 'pending'; // Not Started / In Progress / Awaiting User / Resubmitted
  }
}

const FETCH_TIMEOUT_MS = 10_000;

async function diditFetch(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.diditBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': config.diditApiKey, ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`didit ${path} → ${res.status} ${detail}`);
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export const diditProvider: KycProvider = {
  name: 'didit',

  async start({ vendorData, callbackUrl }): Promise<KycStartResult> {
    const data = await diditFetch('/v3/session/', {
      method: 'POST',
      body: JSON.stringify({
        workflow_id: config.diditWorkflowId,
        vendor_data: vendorData,
        ...(callbackUrl ? { callback: callbackUrl } : {}),
      }),
    });
    const sessionId = typeof data.session_id === 'string' ? data.session_id : '';
    const url = typeof data.url === 'string' ? data.url : '';
    if (!sessionId || !url) throw new Error('didit: session response missing session_id/url');
    return { mode: 'redirect', sessionId, url };
  },

  async pollDecision(sessionId): Promise<KycDecision | null> {
    const data = await diditFetch(`/v3/session/${encodeURIComponent(sessionId)}/decision/`, { method: 'GET' });
    return { sessionId, status: mapStatus(data.status) };
  },

  verifyWebhook(body, headers): boolean {
    // No secret configured → treat as open (dev/sandbox only), mirroring the Helius webhook.
    if (!config.diditWebhookSecret) return true;

    const ts = Number(headers['x-timestamp']);
    if (Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) > REPLAY_WINDOW_S) return false;

    const provided = headers['x-signature-simple'] || headers['x-signature'];
    if (!provided) return false;

    // Didit's "simple" signature is an HMAC-SHA256 over a small canonical string. The exact field
    // order has varied across docs, so we accept either documented form — and the decision poll is
    // authoritative regardless, so a format drift only disables the webhook fast-path, never safety.
    const candidates = [
      `${String(body.session_id)}|${String(body.status)}|${String(body.created_at)}`,
      `${headers['x-timestamp']}:${String(body.session_id)}:${String(body.status)}:${String(body.webhook_type)}`,
    ];
    return candidates.some((msg) => {
      const expected = createHmac('sha256', config.diditWebhookSecret).update(msg).digest('hex');
      try {
        return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
      } catch {
        return false; // length mismatch
      }
    });
  },
};
