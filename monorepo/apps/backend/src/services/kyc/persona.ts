// Persona identity verification (M7). Hosted document + selfie flow: we create an inquiry, the user
// completes it at the hosted URL, and we learn the outcome from the vendor API. `GET inquiry`
// (authenticated with our API key) is the SOURCE OF TRUTH for tier upgrades; the 15s reconciler
// poller reads it, so correctness never depends on a webhook arriving.
import { config } from '../../envConfig';

import type { KycDecision, KycProvider, KycStartResult } from './provider';

const FETCH_TIMEOUT_MS = 10_000;
const HOSTED_FLOW_URL = 'https://inquiry.withpersona.com/verify';
const API_VERSION = '2025-12-08';

type Resource = { id?: string; type?: string; attributes?: Record<string, unknown> };

/** Map Persona inquiry statuses to our normalized outcome. */
function mapStatus(s: unknown): KycDecision['status'] {
  switch (String(s ?? '')) {
    case 'approved':
    case 'completed': // ponytail: "required checks passed" — move to in_review if a review Workflow is ever added
      return 'approved';
    case 'declined':
    case 'failed':
      return 'declined';
    case 'needs_review':
      return 'in_review';
    case 'expired':
      return 'expired'; // terminal-but-unverified — stop reconciling (the user can start over)
    default:
      return 'pending'; // created / pending
  }
}

async function personaFetch(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.personaBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.personaApiKey}`,
        'persona-version': API_VERSION,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Fingerprint which credential produced this: template id isn't secret, and the key's length +
      // last 4 is enough to diff a deployment against a working local run without logging the key.
      const k = config.personaApiKey;
      throw new Error(
        `persona ${path} → ${res.status} ${detail} [template=${config.personaTemplateId} key=len${k.length}…${k.slice(-4)}]`,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export const personaProvider: KycProvider = {
  name: 'persona',

  async start({ vendorData, callbackUrl }): Promise<KycStartResult> {
    const { data } = (await personaFetch('/api/v1/inquiries', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          attributes: {
            'inquiry-template-id': config.personaTemplateId,
            'reference-id': vendorData,
            ...(callbackUrl ? { 'redirect-uri': callbackUrl } : {}),
          },
        },
      }),
    })) as { data?: Resource };
    const sessionId = data?.id ?? '';
    if (!sessionId) throw new Error('persona: inquiry response missing data.id');
    // A freshly created inquiry opens from its id alone (no session token). On Completed/Failed Persona
    // redirects to redirect-uri with ?inquiry-id=…&reference-id=…&status=… appended (web home/page.tsx).
    const url = new URL(HOSTED_FLOW_URL);
    url.searchParams.set('inquiry-id', sessionId);
    if (callbackUrl) url.searchParams.set('redirect-uri', callbackUrl);
    return { mode: 'redirect', sessionId, url: url.toString() };
  },

  async pollDecision(sessionId): Promise<KycDecision | null> {
    const { data, included = [] } = (await personaFetch(
      `/api/v1/inquiries/${encodeURIComponent(sessionId)}?include=verifications`,
      { method: 'GET' },
    )) as { data?: Resource; included?: Resource[] };
    // The document's issuing country, already ISO 3166-1 alpha-2 on Persona; undefined on any drift.
    const gov = included.find((r) => r.type === 'verification/government-id' && r.attributes?.status === 'passed');
    const cc = String(gov?.attributes?.['country-code'] ?? '').toUpperCase();
    return { sessionId, status: mapStatus(data?.attributes?.status), country: /^[A-Z]{2}$/.test(cc) ? cc : undefined };
  },

  // ponytail: webhook not wired — the 15s poller is authoritative (same contract as before).
  // Persona signs `Persona-Signature: t=…,v1=…` = HMAC-SHA256(secret, `${t}.${rawBody}`) and this
  // Fastify parses JSON before any handler runs; add a `parseAs: 'string'` content-type parser scoped
  // to /webhooks/kyc, PERSONA_WEBHOOK_SECRET, and read body.data.attributes.payload.data.id if instant
  // approval ever matters more than ≤15s.
  verifyWebhook: () => false,
};

/** Boot self-check, non-fatal, one log line: does Persona accept the deployed key? `assertKycConfig`
 *  proves the vars are set; a key mangled or swapped in a host's variable panel otherwise boots
 *  "healthy" and 503s every /kyc/verify until someone clicks and reads the log. Templates aren't
 *  readable with a sandbox key, so a bad template id still surfaces on the first verify — with the
 *  same fingerprint. Never throws, never logs the key. */
export async function probePersona(log: (m: string) => void): Promise<void> {
  if (!config.personaLive) return; // not selected, or credentials blanked — nothing to probe
  const k = config.personaApiKey;
  const fp = `[template=${config.personaTemplateId} key=len${k.length}…${k.slice(-4)}]`;
  const env = k.startsWith('persona_sandbox_') ? 'sandbox' : k.startsWith('persona_production_') ? 'production' : 'unknown-prefix';
  try {
    await personaFetch('/api/v1/inquiries?page[size]=1', { method: 'GET' });
    log(`persona probe: key OK (${env}) ${fp}`);
  } catch (err) {
    log(`persona probe FAILED: ${(err as Error).message}`); // a 4xx already carries the fingerprint
  }
}
